sap.ui.define([
	"./BaseController",
	"sap/ui/model/json/JSONModel",
	"sap/m/MessageBox",
	"sap/m/MessageToast",
	"sap/m/Dialog",
	"sap/m/Button",
	"sap/ui/model/Filter",
	"sap/ui/model/FilterOperator",
	"sap/ui/core/Fragment"
], function(BaseController, JSONModel, MessageBox, MessageToast, Dialog, Button, Filter, FilterOperator, Fragment) {
	"use strict";

	return BaseController.extend("com.infocus.zfifixeddepositZFI_FIXED_DEPOSIT.controller.AutoRenewal", {

		onInit: function() {
			BaseController.prototype.onInit.apply(this, arguments);
			this.getView().setModel(new JSONModel({}), "renew");
			this._sMonthFilter = "all";
			this._sSearchQuery = "";

			var oRouter = this.getOwnerComponent() && this.getOwnerComponent().getRouter();
			if (oRouter) {
				var oRoute = oRouter.getRoute("autoRenewal");
				if (oRoute) {
					oRoute.attachPatternMatched(this._onRouteMatched, this);
				}
			}
		},

		_onRouteMatched: function() {
			this._applyAutoRenewalFilters();
		},

		onMonthFilterChange: function(oEvent) {
			var sKey = oEvent.getSource().getSelectedKey() || "all";
			this._sMonthFilter = sKey;

			var oModel = this.getView().getModel();
			if (oModel) {
				oModel.setProperty("/selectedRenewalMonthKey", sKey);
				var aMonths = oModel.getProperty("/renewalMonths") || [];
				var oFound = aMonths.find(function(m) { return m.key === sKey; });
				oModel.setProperty("/selectedRenewalMonthText", oFound ? oFound.text : "All Months");
			}

			this._applyAutoRenewalFilters();
		},

		onSearchAutoRenewal: function(oEvent) {
			this._sSearchQuery = (oEvent.getParameter("newValue") || "").trim();
			this._applyAutoRenewalFilters();
		},

		_getMonthFilterKey: function() {
			if (this._sMonthFilter) {
				return this._sMonthFilter;
			}
			var oModel = this.getView().getModel();
			return (oModel && oModel.getProperty("/selectedRenewalMonthKey")) || "all";
		},

		_applyAutoRenewalFilters: function() {
			var oTable = this.getView().byId("autoRenewalTable");
			if (!oTable) {
				return;
			}
			var oBinding = oTable.getBinding("items");
			if (!oBinding) {
				return;
			}

			var aFilters = [];
			var sMonthKey = this._getMonthFilterKey();

			if (sMonthKey && sMonthKey !== "all") {
				aFilters.push(new Filter("maturityMonthKey", FilterOperator.EQ, sMonthKey));
			}

			if (this._sSearchQuery && this._sSearchQuery.length > 0) {
				aFilters.push(new Filter({
					filters: [
						new Filter("id", FilterOperator.Contains, this._sSearchQuery),
						new Filter("bank", FilterOperator.Contains, this._sSearchQuery)
					],
					and: false
				}));
			}

			oBinding.filter(aFilters);
		},

		onSelectAutoRenewalFd: function(oEvent) {
			var oTable = oEvent.getSource();
			var bSelected = oEvent.getParameter("selected");
			var oContext = oEvent.getParameter("listItem").getBindingContext();
			
			if (bSelected) {
				var oFd = oContext.getObject();

				if (oFd.renewalDocNo) {
					MessageBox.error("Renewal is already done for this Fixed Deposit.");
					oTable.removeSelections(true);
					return;
				}

				var oServiceModel = this.getOwnerComponent().getModel();
				if (!oServiceModel || !oServiceModel.read) {
					this._openRenewalDialog(oFd);
					oTable.removeSelections(true);
					return;
				}

				sap.ui.core.BusyIndicator.show(0);
				oServiceModel.read("/MaturityDataDisplaySet", {
					filters: [
						new Filter("CoCode", FilterOperator.EQ, oFd.coCode),
						new Filter("FdAccno", FilterOperator.EQ, oFd.id)
					],
					success: function(oResponse) {
						sap.ui.core.BusyIndicator.hide();
						var aResults = oResponse.results || [];
						var bMatured = aResults.some(function(oRec) { return !!oRec.TDS_DOC_NO; });
						
						if (bMatured) {
							MessageBox.error("Maturity is already done for this Fixed Deposit. Renewal cannot be performed.");
							oTable.removeSelections(true);
						} else {
							this._openRenewalDialog(oFd);
							oTable.removeSelections(true);
						}
					}.bind(this),
					error: function() {
						sap.ui.core.BusyIndicator.hide();
						MessageBox.error("Failed to verify FD maturity status.");
						oTable.removeSelections(true);
					}
				});
			}
		},


		_openRenewalDialog: function(oFd) {
			var oView = this.getView();
			var oRenewModel = oView.getModel("renew");
			
			// Calculate system interest
			var oStartDate = new Date(oFd.start);
			var oMaturityDate = new Date(oFd.maturityDateOData || oFd.maturityDate || oFd.start); // fallback
			if (oFd.maturityText && oFd.maturityText.length > 0) {
				// use the actual parsed maturity date if available
				oMaturityDate = this._maturityDate(oFd);
			}
			
			var iDays = 0;
			if (oStartDate && oMaturityDate) {
				oStartDate.setHours(0,0,0,0);
				oMaturityDate.setHours(0,0,0,0);

				var oToday = new Date();
				oToday.setHours(0, 0, 0, 0);

				var oEffectiveDate = new Date(oToday.getTime());
				if (oEffectiveDate > oMaturityDate) {
					oEffectiveDate = new Date(oMaturityDate.getTime());
				}

				var iDiffTime = oEffectiveDate.getTime() - oStartDate.getTime();
				iDays = Math.round(iDiffTime / (1000 * 3600 * 24));
				if (iDays < 0) iDays = 0;
			}
			
			var sCalculatedTenorMonths = (iDays / (365/12)).toFixed(1);
			var fSystemInterest = (oFd.principal * (oFd.rate / 100) * iDays) / 365;
			var fTotalValue = oFd.principal + fSystemInterest;
			
			var sEffectiveDateFormatted = oEffectiveDate ? this._fmtDate(oEffectiveDate) : "";
			var sInterestCalcText = "(Calculated till " + sEffectiveDateFormatted + " - " + iDays + " days)";

			oRenewModel.setData({
				// Auto values
				currentFdNo: oFd.id,
				bankName: oFd.bank,
				principalAmount: oFd.principal,
				principalAmountFormatted: this._fmt(oFd.principal),
				currentTenure: oFd.tenor,
				calculatedTenure: sCalculatedTenorMonths,
				currentFdRate: oFd.rate,
				systemInterest: fSystemInterest.toFixed(2),
				systemInterestFormatted: this._fmt(fSystemInterest.toFixed(2)),
				interestCalculationText: sInterestCalcText,
				totalFdValue: fTotalValue.toFixed(2),
				totalFdValueFormatted: this._fmt(fTotalValue.toFixed(2)),
				startDate: oMaturityDate ? this._fmtDate(oMaturityDate) : "",
				startDateRaw: oMaturityDate,
				
				// Original FD reference for the API call
				originalFd: oFd,

				// Manual inputs
				totalInterestBank: "",
				tdsInd: false,
				tdsAmount: "",
				proposedRate: "",
				tenorYears: "",
				tenorMonths: "",
				tenorDays: "",
				renewalTenor: 0,
			});

			if (!this._oRenewalDialog) {
				this._oRenewalDialog = sap.ui.xmlfragment(
					oView.getId(),
					"com.infocus.zfifixeddepositZFI_FIXED_DEPOSIT.view.RenewalDialog",
					this
				);
				oView.addDependent(this._oRenewalDialog);
			}
			this._oRenewalDialog.open();
		},

		onCloseRenewalDialog: function() {
			if (this._oRenewalDialog) {
				this._oRenewalDialog.close();
			}
		},

		onCalculateNewFdValue: function() {
			var oRenewModel = this.getView().getModel("renew");
			var oData = oRenewModel.getData();
			
			var fPrincipal = parseFloat(oData.principalAmount) || 0;
			var fInterest = oData.totalInterestBank ? parseFloat(oData.totalInterestBank) : parseFloat(oData.systemInterest);
			var fTds = oData.tdsInd ? (parseFloat(oData.tdsAmount) || 0) : 0;
			
			var fNewValue = fPrincipal + (fInterest || 0) - fTds;
			oRenewModel.setProperty("/totalFdValue", fNewValue.toFixed(2));
			oRenewModel.setProperty("/totalFdValueFormatted", this._fmt(fNewValue.toFixed(2)));

			var iYears = Math.max(0, parseInt(oData.tenorYears, 10) || 0);
			var iMonths = Math.max(0, parseInt(oData.tenorMonths, 10) || 0);
			var iDays = Math.max(0, parseInt(oData.tenorDays, 10) || 0);
			var fTotalMonths = (iYears * 12) + iMonths + (iDays / 30);
			var sTenor = (fTotalMonths % 1 === 0) ? String(fTotalMonths) : fTotalMonths.toFixed(2);
			oRenewModel.setProperty("/renewalTenor", sTenor);
		},

		onSubmitAutoRenew: function() {
			var oRenewModel = this.getView().getModel("renew");
			var oData = oRenewModel.getData();
			var oFd = oData.originalFd;
			
			if (!oFd || !oFd.id) { MessageBox.error("Invalid FD selected."); return; }
			if (!oFd.coCode) { MessageBox.error("Company code is missing."); return; }
			if (!oFd.profitCenter) { MessageBox.error("Profit center is missing."); return; }
			if (!oFd.glP) { MessageBox.error("Principal GL is missing."); return; }
			if (!oFd.glInc) { MessageBox.error("Income GL is missing."); return; }

			var iYears = Math.max(0, parseInt(oData.tenorYears, 10) || 0);
			var iMonths = Math.max(0, parseInt(oData.tenorMonths, 10) || 0);
			var iDays = Math.max(0, parseInt(oData.tenorDays, 10) || 0);

			var fTotalMonths = (iYears * 12) + iMonths + (iDays / 30);
			var sRenewalTenor = (fTotalMonths % 1 === 0) ? String(fTotalMonths) : fTotalMonths.toFixed(2);
			oData.renewalTenor = sRenewalTenor;

			var aRequiredFields = ["proposedRate", "totalInterestBank"];
			if (oData.tdsInd) {
				aRequiredFields.push("tdsAmount");
			}

			var bIncomplete = aRequiredFields.some(function(sProp) {
				var vValue = oData[sProp];
				return vValue === undefined || vValue === null || String(vValue).trim() === "";
			});

			if (bIncomplete || parseFloat(oData.renewalTenor) <= 0) {
				MessageBox.error("Please fill in all manual input fields and ensure tenure is greater than 0.");
				return;
			}
			
			var fTdsAmt = oData.tdsInd ? (parseFloat(oData.tdsAmount) || 0) : 0;
			
			var oServiceModel = this.getOwnerComponent().getModel();
			
			var sFilter = "FdAccno eq '" + String(oFd.id) + "'" +
				" and InterestRate eq " + Number(parseFloat(oData.proposedRate).toFixed(2)) +
				" and INT_AMT eq '" + Number(parseFloat(oData.totalInterestBank).toFixed(2)).toString() + "'" +
				" and TDS_AMT eq " + Number(fTdsAmt.toFixed(2)) +
				" and TDS_IND eq '" + (oData.tdsInd ? "X" : "") + "'" +
				" and RENEWAL_TENOR eq '" + String(oData.renewalTenor) + "'";

			sap.ui.core.BusyIndicator.show(0);

			oServiceModel.read("/FD_RENEWALSet", {
				urlParameters: {
					"$filter": sFilter
				},
				success: function(oResponse) {
					sap.ui.core.BusyIndicator.hide();
					this.onCloseRenewalDialog();
					
					var aResults = oResponse.results || [];
					if (aResults.length > 0 && aResults[0].Message) {
						MessageBox.information(aResults[0].Message);
					} else {
						MessageToast.show("FD Renewed Successfully");
					}
					
					// Refresh data
					this._loadFdDetailsFromService();
				}.bind(this),
				error: function(oError) {
					sap.ui.core.BusyIndicator.hide();
					MessageBox.error(this._extractODataError(oError));
				}.bind(this)
			});
		}
	});
});
