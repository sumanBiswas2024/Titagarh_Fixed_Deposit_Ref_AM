sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/model/json/JSONModel",
	"sap/m/MessageBox",
	"sap/m/MessageToast",
	"sap/m/SelectDialog",
	"sap/m/StandardListItem",
	"sap/ui/core/CustomData",
	"sap/ui/model/Filter",
	"sap/ui/model/FilterOperator",
	"sap/ui/model/Sorter",
	"sap/ui/core/BusyIndicator",
	"sap/m/ActionSheet",
	"sap/m/Dialog",
	"sap/m/Button",
	"sap/m/CheckBox",
	"sap/m/VBox",
	"sap/ui/export/Spreadsheet",
	"../util/Frequency",
	"../util/ODataErrorHandler",
	"../service/FdDetailsService"
], function(Controller, JSONModel, MessageBox, MessageToast, SelectDialog, StandardListItem, CustomData, Filter, FilterOperator, Sorter,
	BusyIndicator, ActionSheet, Dialog, Button, CheckBox, VBox, Spreadsheet, Frequency, ODataErrorHandler, FdDetailsService) {
	"use strict";

	return Controller.extend("com.infocus.zfifixeddepositZFI_FIXED_DEPOSIT.controller.BaseController", {

		// UI5 lifecycle hook. This guarantees initializeApplication() actually
		// runs. If a child controller defines its own onInit, it MUST call
		// BaseController.prototype.onInit.apply(this, arguments) (or simply
		// this.initializeApplication()) itself, otherwise this one is skipped.
		onInit: function() {

			this.initializeApplication();
		},

		initializeApplication: function() {

			this._fds = [];
			this._entries = [];
			this._f4Cache = {};
			this._f4Dialogs = {};
			this._asOfDate = this._startOfDay(new Date());
			this._loadState = {
				status: "Loading FdDetailsSet...",
				state: "Warning"
			};

			// Active-FDs table toolbar state: free-text search, quick-filter
			// chip, status checkboxes from the filter dialog, and an optional
			// KPI click-through filter. _applyTableFilters() combines all of
			// these into a single client-side filter on the table binding.
			this._tableFilters = {
				search: "",
				quick: "all",
				statusChecks: [],
				kpi: null
			};

			this.getView().setModel(new JSONModel(this._buildAppData()));
			this.getView().setModel(new JSONModel(this._buildUiState("dashboard")), "ui");
			this.getView().setModel(new JSONModel({
				principal: "",
				rate: "",
				tenor: "",
				freq: "12",
				maturityValueText: "",
				interestText: "",
				monthlyText: ""
			}), "calc");
			this.getView().setModel(new JSONModel(this._defaultNewFd()), "newFd");
			this.getView().setModel(new JSONModel(this._defaultLegacyFd()), "legacyFd");
			this._setCurrentFiscalYear();
			this._loadFdDetailsFromService();
			this._attachKpiCardHandlers();
		},

		onNavDashboard: function() {
			this._setPage("dashboard");
		},
		onNavFds: function() {
			this._setPage("fds");
		},
		onNavInterest: function() {
			this._setPage("interest");
		},
		onNavMaturity: function() {
			this._setPage("maturity");
		},
		onNavMaturityAlerts: function() {
			this._setPage("maturityAlerts");
		},
		onNavMaturityCalendar: function() {
			this._setPage("maturityCalendar");
		},
		onNavAccounting: function() {
			this._setPage("accounting");
		},
		onNavMonthEnd: function() {
			this._setPage("monthEnd");
		},
		onNavNewfd: function() {
			this._setPage("newfd");
		},
		onNavLegacyFd: function() {
			this._setPage("legacyfd");
		},
		onNavAutoRenewal: function() {
			this._setPage("autoRenewal");
		},
		onNavSettings: function() {
			this._setPage("settings");
		},

		onCompanyCodeValueHelp: function() {
			this._openValueHelp({
				title: "Company Code",
				entitySet: "/CocodeF4Set",
				titleProperty: "BUKRS",
				descriptionProperty: "BUTXT",
				targetPath: "/coCode"
			});
		},

		onBankNameValueHelp: function() {

			this._openValueHelp({
				title: "Bank Account",
				entitySet: "/BankNameF4Set",
				titleProperty: "BANKN",
				descriptionProperty: "TEXT1",

				// Store bank name instead of account number
				valueProperty: "TEXT1",

				targetPath: "/bank",

				additionalMappings: [{
					source: "HKONT",
					target: "/bankGL"
				}]
			});

		},

		onGlPrincipalValueHelp: function() {
			this._openValueHelp({
				title: "FD Principal GL",
				entitySet: "/GlPrincipalSet",
				titleProperty: "GlAcc",
				targetPath: "/glP"
			});
		},

		onBankGlValueHelp: function() {
			this._openValueHelp({
				title: "Bank GL",
				entitySet: "/BankGLF4Set",
				titleProperty: "BANKN",
				descriptionProperty: "Txt50",
				targetPath: "/bankGL"
			});
		},

		onGlReceivableValueHelp: function() {
			this._openValueHelp({
				title: "Interest Receivable GL",
				entitySet: "/GlReceivableSet",
				titleProperty: "GlRece",
				targetPath: "/glI"
			});
		},

		onGlIncomeValueHelp: function() {
			this._openValueHelp({
				title: "Interest Income GL",
				entitySet: "/GlInterestSet",
				titleProperty: "GlInte",
				targetPath: "/glInc"
			});
		},
		onDisplayJournalEntry: function(oEvent) {

			var oSource = oEvent.getSource();

			var oContext =
				oSource.getBindingContext("maturityDisplay") ||
				oSource.getBindingContext();

			if (!oContext) {
				MessageToast.show("Unable to determine selected record.");
				return;
			}

			var oData = oContext.getObject();

			// Determine which link was clicked
			var oBindingInfo = oSource.getBindingInfo("text");
			var sBoundPath = oBindingInfo &&
				oBindingInfo.parts &&
				oBindingInfo.parts[0] &&
				oBindingInfo.parts[0].path;

			var bReversal = sBoundPath === "fdRevNo" ||
				sBoundPath === "FD_REV_NO" ||
				sBoundPath === "fdRevNoText";

			var bTds = sBoundPath === "tdsDocNo" ||
				sBoundPath === "TDS_DOC_NO";

			var bRenewal = sBoundPath === "renewalDocNo" ||
				sBoundPath === "renewalDocNoText";

			var sDocNo;

			if (bReversal) {
				sDocNo = oData.fdRevNo || oData.FD_REV_NO;
			} else if (bTds) {
				sDocNo = oData.tdsDocNo || oData.TDS_DOC_NO;
			} else if (bRenewal) {
				sDocNo = oData.renewalDocNo || oData.RENEWAL_DOC_NO;
			} else {
				sDocNo = oData.fdDocNo || oData.FD_DOC_NO;
			}

			if (!sDocNo) {
				MessageToast.show((bReversal ? "Reversal" : bTds ? "TDS" : bRenewal ? "Renewal" : "Accounting") + " Document not available.");
				return;
			}

			// Determine the relevant date for Fiscal Year calculation based on document type
			var oDate;

			if (bTds) {
				// Maturity/TDS document is posted at maturity
				var vMatDate = oData.maturity || oData.maturityDate;
				oDate = vMatDate ? this._parseODataDate(vMatDate) : new Date();
			} else if (bReversal) {
				// Reversal documents are posted during month-end or maturity
				oDate = new Date();
			} else if (bRenewal) {
				// Renewal document is posted on the renewal date
				var sRenewalDate = oData.renewalDate || oData.RENEWAL_DATE;
				oDate = sRenewalDate ? this._parseODataDate(sRenewalDate) : new Date();
			} else {
				// FD opening document is posted on the start date
				var sStartDate = oData.start || oData.startDate;
				if (!sStartDate) {
					MessageToast.show("Start Date not available.");
					return;
				}
				oDate = this._parseODataDate(sStartDate);
			}

			if (!oDate || isNaN(oDate.getTime())) {
				oDate = new Date(); // Safe fallback
			}

			var iYear = oDate.getFullYear();
			var iMonth = oDate.getMonth() + 1;

			var sFiscalYear = (iMonth >= 4) ?
				String(iYear) :
				String(iYear - 1);

			sap.ushell.Container
				.getService("CrossApplicationNavigation")
				.toExternal({
					target: {
						semanticObject: "AccountingDocument",
						action: "displayDocument"
					},
					params: {
						CompanyCode: oData.coCode || oData.CoCode,
						AccountingDocument: sDocNo,
						FiscalYear: sFiscalYear
					}
				});

		},
		onProfitCenterValueHelp: function() {
			this._openValueHelp({
				title: "Profit Center",
				entitySet: "/ProfitCenterF4Set",
				titleProperty: "Prctr",
				descriptionProperty: "ktext",
				targetPath: "/profitCenter"
			});
		},

		onOpeningFdValueHelp: function() {
			this._openValueHelp({
				title: "Purpose of Opening a FD",
				entitySet: "/PurposeF4Set",
				titleProperty: "Purpose",
				targetPath: "/openingFd"
			});
		},

		onLegacyCompanyCodeValueHelp: function() {
			this._openValueHelp({
				title: "Company Code",
				entitySet: "/CocodeF4Set",
				titleProperty: "BUKRS",
				descriptionProperty: "BUTXT",
				targetPath: "/coCode",
				modelName: "legacyFd"
			});
		},

		onLegacyBankNameValueHelp: function() {

			this._openValueHelp({
				title: "Bank Account",
				entitySet: "/BankNameF4Set",
				titleProperty: "BANKN",
				descriptionProperty: "TEXT1",

				valueProperty: "TEXT1",

				targetPath: "/bank",
				modelName: "legacyFd",

				additionalMappings: [{
					source: "HKONT",
					target: "/bankGL"
				}]
			});

		},

		onLegacyOpeningFdValueHelp: function() {
			this._openValueHelp({
				title: "Purpose of Opening a FD",
				entitySet: "/PurposeF4Set",
				titleProperty: "Purpose",
				targetPath: "/openingFd",
				modelName: "legacyFd"
			});
		},

		onLegacyGlPrincipalValueHelp: function() {
			this._openValueHelp({
				title: "FD Principal GL",
				entitySet: "/GlPrincipalSet",
				titleProperty: "GlAcc",
				targetPath: "/glP",
				modelName: "legacyFd"
			});
		},

		onLegacyBankGlValueHelp: function() {
			this._openValueHelp({
				title: "Bank GL",
				entitySet: "/BankGLF4Set",
				titleProperty: "saknr",
				descriptionProperty: "Txt50",
				targetPath: "/bankGL",
				modelName: "legacyFd"
			});
		},

		onLegacyGlReceivableValueHelp: function() {
			this._openValueHelp({
				title: "Interest Receivable GL",
				entitySet: "/GlReceivableSet",
				titleProperty: "GlRece",
				targetPath: "/glI",
				modelName: "legacyFd"
			});
		},

		onLegacyGlIncomeValueHelp: function() {
			this._openValueHelp({
				title: "Interest Income GL",
				entitySet: "/GlInterestSet",
				titleProperty: "GlInte",
				targetPath: "/glInc",
				modelName: "legacyFd"
			});
		},

		onLegacyProfitCenterValueHelp: function() {
			this._openValueHelp({
				title: "Profit Center",
				entitySet: "/ProfitCenterF4Set",
				titleProperty: "Prctr",
				descriptionProperty: "ktext",
				targetPath: "/profitCenter",
				modelName: "legacyFd"
			});
		},

		onFDFilter: function(oEvent) {
			this.getView().getModel("ui").setProperty("/fdFilter", oEvent.getParameter("key"));
			this._refresh();
		},

		onAcctFilter: function(oEvent) {
			this.getView().getModel("ui").setProperty("/acctFilter", oEvent.getParameter("key"));
			this._refresh();
		},

		// ---------- Active FDs table toolbar: search / quick filter / sort / filter dialog / export ----------

		onSearchFD: function(oEvent) {
			this._tableFilters.search = (oEvent.getParameter("newValue") || "").trim();
			this._applyTableFilters();
		},

		onQuickFilterFD: function(oEvent) {
			this._tableFilters.quick = oEvent.getParameter("key") || "all";
			this._tableFilters.kpi = null;
			this._applyTableFilters();
		},

		onSortFD: function(oEvent) {
			if (!this._oSortActionSheet) {

				var aOptions = [{
					text: "Principal (High to Low)",
					path: "principal",
					descending: true
				}, {
					text: "Start Date (Newest first)",
					path: "start",
					descending: true
				}, {
					text: "Maturity (Soonest first)",
					path: "start",
					descending: false
				}, {
					text: "Creation Date (Newest first)",
					path: "creationDate",
					descending: true
				}, {
					text: "Bank (A-Z)",
					path: "bank",
					descending: false
				}];

				this._oSortActionSheet = new ActionSheet({
					title: "Sort by",
					buttons: aOptions.map(function(oOption) {
						return new Button({
							text: oOption.text,
							press: function() {
								var oBinding = this.byId("fdTable") && this.byId("fdTable").getBinding("items");
								if (oBinding) {
									oBinding.sort(new Sorter(oOption.path, oOption.descending));
								}
							}.bind(this)
						});
					}.bind(this))
				});

				this.getView().addDependent(this._oSortActionSheet);
			}

			this._oSortActionSheet.openBy(oEvent.getSource());
		},

		onFilterFD: function() {
			if (!this._oFilterDialog) {

				var oFilterModel = new JSONModel({
					active: this._tableFilters.statusChecks.indexOf("active") > -1,
					matured: this._tableFilters.statusChecks.indexOf("matured") > -1,
					renewed: this._tableFilters.statusChecks.indexOf("renewed") > -1,
					autoRenew: this._tableFilters.statusChecks.indexOf("autoRenew") > -1
				});

				this._oFilterDialog = new Dialog({
					title: "Filter Fixed Deposits",
					contentWidth: "20rem",
					content: [
						new VBox({
							items: [
								new CheckBox({
									text: "Active",
									selected: "{filter>/active}"
								}),
								new CheckBox({
									text: "Matured",
									selected: "{filter>/matured}"
								}),
								new CheckBox({
									text: "Renewed",
									selected: "{filter>/renewed}"
								}),
								new CheckBox({
									text: "Auto Renew",
									selected: "{filter>/autoRenew}"
								})
							]
						}).addStyleClass("sapUiSmallMargin")
					],
					beginButton: new Button({
						text: "Apply",
						type: "Emphasized",
						press: function() {
							var oData = oFilterModel.getData();
							this._tableFilters.statusChecks = Object.keys(oData).filter(function(sKey) {
								return oData[sKey];
							});
							this._applyTableFilters();
							this._oFilterDialog.close();
						}.bind(this)
					}),
					endButton: new Button({
						text: "Cancel",
						press: function() {
							this._oFilterDialog.close();
						}.bind(this)
					})
				});

				this._oFilterDialog.setModel(oFilterModel, "filter");
				this.getView().addDependent(this._oFilterDialog);
			}

			this._oFilterDialog.open();
		},

		onExportFD: function() {
			var oTable = this.byId("fdTable");
			var oBinding = oTable && oTable.getBinding("items");

			if (!oBinding) {
				MessageToast.show("Nothing to export.");
				return;
			}

			var aContexts = oBinding.getContexts(0, oBinding.getLength());
			var aRows = aContexts.map(function(oContext) {
				return oContext.getObject();
			});

			if (!aRows.length) {
				MessageToast.show("No rows match the current filter.");
				return;
			}

			var aColumns = [{
				label: "FD Number",
				property: "id",
				type: "string"
			}, {
				label: "Bank",
				property: "bank",
				type: "string"
			}, {
				label: "Principal",
				property: "principalText",
				type: "string"
			}, {
				label: "Lien Amount",
				property: "lienAmtText",
				type: "string"
			}, {
				label: "Not Lien Amount",
				property: "notLienAmtText",
				type: "string"
			}, {
				label: "Rate",
				property: "rateText",
				type: "string"
			}, {
				label: "Start",
				property: "startText",
				type: "string"
			}, {
				label: "Creation Date",
				property: "creationDateText",
				type: "string"
			}, {
				label: "Maturity",
				property: "maturityText",
				type: "string"
			}, {
				label: "Status",
				property: "statusText",
				type: "string"
			}, {
				label: "Accounting Doc",
				property: "fdDocNoText",
				type: "string"
			}, {
				label: "Renewal Document",
				property: "renewalDocNoText",
				type: "string"
			}, {
				label: "Renewal Date",
				property: "renewalDateText",
				type: "string"
			}, {
				label: "Renewal Amount",
				property: "renewalAmtText",
				type: "string"
			}, {
				label: "Auto-renew",
				property: "autoRenewText",
				type: "string"
			}];

			var oSheet = new Spreadsheet({
				workbook: {
					columns: aColumns,
					context: {
						title: "Active Fixed Deposits"
					}
				},
				dataSource: aRows,
				fileName: "Active_Fixed_Deposits.xlsx",
				worker: false
			});

			oSheet.build()
				.then(function() {
					MessageToast.show("Export complete.");
				})
				.catch(function() {
					MessageBox.error("Export failed.");
				})
				.finally(function() {
					oSheet.destroy();
				});
		},

		onCalculateInterest: function() {
			var oCalcModel = this.getView().getModel("calc");
			var oCalc = oCalcModel.getData();
			var iPrincipal = Number(oCalc.principal) || 0;
			var fRate = (Number(oCalc.rate) || 0) / 100;
			var sStart = oCalc.startDate;
			var sMaturity = oCalc.maturityDate;

			if (!iPrincipal || !fRate || !sStart || !sMaturity) {
				oCalcModel.setProperty("/maturityValueText", "");
				oCalcModel.setProperty("/interestText", "");
				return;
			}

			var oStartDate = new Date(sStart);
			var oMaturityDate = new Date(sMaturity);

			if (isNaN(oStartDate.getTime()) || isNaN(oMaturityDate.getTime())) {
				oCalcModel.setProperty("/maturityValueText", "");
				oCalcModel.setProperty("/interestText", "");
				return;
			}

			// Inclusive days counting
			oStartDate.setHours(0, 0, 0, 0);
			oMaturityDate.setHours(0, 0, 0, 0);
			var iDiffTime = oMaturityDate.getTime() - oStartDate.getTime();
			var iDays = Math.floor(iDiffTime / (1000 * 3600 * 24)) + 1;
			if (iDays < 0) iDays = 0;

			// Principal * Rate * Days / 365
			var fInterest = (iPrincipal * fRate * iDays) / 365;
			var fMaturity = iPrincipal + fInterest;

			oCalcModel.setProperty("/maturityValueText", this._fmt(fMaturity));
			oCalcModel.setProperty("/interestText", this._fmt(fInterest));
		},

		_getAccountingDocLienPropertyName: function(oServiceModel) {
			try {
				var oMetadata = oServiceModel && oServiceModel.getServiceMetadata && oServiceModel.getServiceMetadata();
				if (oMetadata && oMetadata.dataServices && oMetadata.dataServices.schema) {
					var aSchemas = oMetadata.dataServices.schema;
					for (var i = 0; i < aSchemas.length; i++) {
						var aEntityTypes = aSchemas[i].entityType || [];
						for (var j = 0; j < aEntityTypes.length; j++) {
							if (aEntityTypes[j].name === "AccountingDoc") {
								var aProps = aEntityTypes[j].property || [];
								for (var k = 0; k < aProps.length; k++) {
									var sProp = aProps[k].name;
									var sNormalized = (sProp || "").toUpperCase().replace(/[^A-Z]/g, "");
									if (sNormalized === "LIENAMT" || sNormalized === "LIEN") {
										return sProp;
									}
								}
								// Entity found in metadata but has no Lien property
								return null;
							}
						}
					}
				}
			} catch (e) {
				console.warn("Unable to check AccountingDoc metadata:", e);
			}
			return "LIEN_AMT";
		},

		_getFdDetailsProperties: function(oServiceModel) {
			try {
				var oMetadata = oServiceModel && oServiceModel.getServiceMetadata && oServiceModel.getServiceMetadata();
				if (oMetadata && oMetadata.dataServices && oMetadata.dataServices.schema) {
					var aSchemas = oMetadata.dataServices.schema;
					for (var i = 0; i < aSchemas.length; i++) {
						var aEntityTypes = aSchemas[i].entityType || [];
						for (var j = 0; j < aEntityTypes.length; j++) {
							if (aEntityTypes[j].name === "FdDetails") {
								var aProps = aEntityTypes[j].property || [];
								return aProps.map(function(p) {
									return p.name;
								});
							}
						}
					}
				}
			} catch (e) {
				console.warn("Unable to check FdDetails metadata:", e);
			}
			return null;
		},

		onCreateFD: function() {

			var oNewFdModel = this.getView().getModel("newFd");
			var oData = oNewFdModel.getData();
			var oServiceModel = this.getOwnerComponent().getModel();

			var sCoCode = (oData.coCode || "").trim();
			var sId = (oData.id || "").trim();
			var sBank = (oData.bank || "").trim();
			var sPrincipal = (oData.principal || "").trim();
			var sLien = (oData.lienAmt !== undefined && oData.lienAmt !== null) ? String(oData.lienAmt).trim() : "";
			var sRate = (oData.rate || "").trim();
			var sTenor = (oData.tenor || "").trim();
			var sOpeningFd = (oData.openingFd || "").trim();
			var sProfitCenter = (oData.profitCenter || "").trim();
			var sBankGl = (oData.bankGL || "").trim();

			if (!oServiceModel || !oServiceModel.read) {
				oNewFdModel.setProperty("/message", "OData model is not available.");
				return;
			}

			console.log({
				coCode: !sCoCode,
				id: !sId,
				bank: !sBank,
				principal: !sPrincipal,
				lien: sLien === "",
				rate: !sRate,
				start: !oData.start,
				tenor: !sTenor,
				freq: !oData.freq,
				openingFd: !sOpeningFd,
				glP: !oData.glP,
				bankGL: !sBankGl,
				glI: !oData.glI,
				glInc: !oData.glInc,
				profitCenter: !sProfitCenter
			});

			// Mandatory field validation
			if (!sCoCode ||
				!sId ||
				!sBank ||
				!sPrincipal ||
				sLien === "" ||
				!sRate ||
				!oData.start ||
				!sTenor ||
				!oData.freq ||
				!sOpeningFd ||
				!oData.glP ||
				!sBankGl ||
				!oData.glI ||
				!oData.glInc ||
				!sProfitCenter
			) {
				oNewFdModel.setProperty("/message", "Please fill all required fields including Lien Amount.");
				MessageBox.error("Please fill all mandatory fields including Lien Amount.");
				return;
			}

			var fPrincipalVal = Number(sPrincipal);
			var fLienVal = Number(sLien);

			if (isNaN(fLienVal) || fLienVal < 0) {
				oNewFdModel.setProperty("/lienValueState", "Error");
				oNewFdModel.setProperty("/lienValueStateText", "Lien Amount must be non-negative.");
				MessageBox.error("Lien Amount must be non-negative.");
				return;
			}

			if (fLienVal > fPrincipalVal) {
				oNewFdModel.setProperty("/lienValueState", "Error");
				oNewFdModel.setProperty("/lienValueStateText", "Lien Amount cannot exceed Principal Amount.");
				MessageBox.error("Lien Amount must not exceed Principal Amount.");
				return;
			}

			var fNotLienVal = fPrincipalVal - fLienVal;
			oNewFdModel.setProperty("/lienValueState", "None");
			oNewFdModel.setProperty("/lienValueStateText", "");
			oNewFdModel.setProperty("/notLienAmt", fNotLienVal);

			// Financial year validation
			var oStartDate = new Date(oData.start + "T00:00:00");

			var oToday = new Date();
			var iYear = oToday.getFullYear();
			var iMonth = oToday.getMonth();

			var oFiscalStart, oFiscalEnd;

			if (iMonth >= 3) {
				oFiscalStart = new Date(iYear, 3, 1);
				oFiscalEnd = new Date(iYear + 1, 2, 31);
			} else {
				oFiscalStart = new Date(iYear - 1, 3, 1);
				oFiscalEnd = new Date(iYear, 2, 31);
			}

			if (oStartDate < oFiscalStart || oStartDate > oFiscalEnd) {
				MessageBox.error("Start Date must be within the current financial year.");
				return;
			}

			oNewFdModel.setProperty("/message", "Creating FD...");
			oNewFdModel.setProperty("/message", "Generating Accounting Document...");
			oNewFdModel.setProperty("/fdDocNo", "");

			console.log("========== NEW FD PAYLOAD (FILTERS) ==========");
			console.log("StartDate:", this._toODataDateTime(oData.start));
			console.log("TenorMonths:", sTenor);
			console.log("MATURITY_DATE:", this._toODataDateTime(oData.calculatedMaturity));
			console.log("Full Local Data:", oData);

			var aDocFilters = [
				new Filter("CoCode", FilterOperator.EQ, sCoCode),
				new Filter("FdAccno", FilterOperator.EQ, sId),
				new Filter("BankName", FilterOperator.EQ, sBank),
				new Filter("PrincipalAmt", FilterOperator.EQ, sPrincipal),
				new Filter("InterestRate", FilterOperator.EQ, sRate),
				new Filter("StartDate", FilterOperator.EQ, this._toODataDateTime(oData.start)),
				new Filter(
					"CREATE_DATE",
					FilterOperator.EQ,
					this._toODataDateTime(oData.createDate)
				),
				new Filter("TenorMonths", FilterOperator.EQ, sTenor),
				new Filter("CompoundFreq", FilterOperator.EQ, this._compoundFreqText(oData.freq)),
				new Filter("OpeningFd", FilterOperator.EQ, sOpeningFd),
				new Filter("GlPrincipal", FilterOperator.EQ, this.padTo10(oData.glP)),
				new Filter("BankGl", FilterOperator.EQ, this.padTo10(sBankGl)),
				new Filter("GlReceivable", FilterOperator.EQ, this.padTo10(oData.glI)),
				new Filter("GlIncome", FilterOperator.EQ, this.padTo10(oData.glInc)),
				new Filter("ProfitCenter", FilterOperator.EQ, this.padTo10(sProfitCenter)),
				new Filter("MATURITY_DATE", FilterOperator.EQ, this._toODataDateTime(oData.calculatedMaturity))
			];

			var sLienPropName = this._getAccountingDocLienPropertyName(oServiceModel);
			if (sLienPropName) {
				aDocFilters.push(new Filter(sLienPropName, FilterOperator.EQ, String(fLienVal)));
			}

			if (sId) {
				try {
					window.localStorage.setItem("FD_LIEN_" + sId, String(fLienVal));
					window.localStorage.setItem("FD_NOT_LIEN_" + sId, String(fNotLienVal));
				} catch (e) {}
			}

			FdDetailsService.generateAccountingDoc(oServiceModel, {

				filters: aDocFilters,

				success: function(oResponse) {

					var aResults = oResponse.results || [];

					if (!aResults.length) {
						MessageBox.error("No response received from backend.");
						return;
					}

					var oResult = aResults[0] || {};
					var sDocNo = oResult.FdDocNo || oResult.FD_DOC_NO || oResult.fd_doc_no || "";
					var sMsg = oResult.Message || "FD Created Successfully";

					if (sDocNo && oData.calculatedMaturity) {
						var sMaturityKey = "FD_MATURITY_" + sDocNo;
						var sIso = this._dateToIso(oData.calculatedMaturity);
						if (sIso) {
							try {
								window.localStorage.setItem(sMaturityKey, sIso);
							} catch (e) {}
						}
					}

					MessageBox.success(sMsg, {
						onClose: function() {
							if (oDialog) {
								oDialog.close();
							}
							this.getEventBus().publish("FD", "Refresh");
						}.bind(this)
					});

					this._resetModelProperties(
						oNewFdModel,
						this._defaultNewFd(sMsg)
					);

					// Set document number after resetting the model
					oNewFdModel.setProperty("/fdDocNo", sDocNo);

					// Refresh OData model
					var oModel = this.getOwnerComponent().getModel();
					oModel.refresh(true);

					// Reload dashboard data
					this._loadFdDetailsFromService();

				}.bind(this),

				error: function(oError) {

					var sMessage = this._extractODataError(oError);

					oNewFdModel.setProperty("/message", sMessage);

					MessageBox.error(sMessage);

				}.bind(this)

			});

		},

		onPostLegacyFD: function() {
			var oLegacyModel = this.getView().getModel("legacyFd");
			var oData = oLegacyModel.getData();
			var oServiceModel = this.getOwnerComponent().getModel();
			var sCoCode = (oData.coCode || "").trim();
			var sId = (oData.id || "").trim();
			var sBank = (oData.bank || "").trim();
			var sPrincipal = (oData.principal || "").trim();
			var sLien = (oData.lienAmt !== undefined && oData.lienAmt !== null) ? String(oData.lienAmt).trim() : "";
			var sRate = (oData.rate || "").trim();
			var sTenor = (oData.tenor || "").trim();
			var sOpeningFd = (oData.openingFd || "").trim();
			var sProfitCenter = (oData.profitCenter || "").trim();

			if (!oServiceModel || !oServiceModel.create) {
				oLegacyModel.setProperty("/message", "OData model is not available.");
				return;
			}

			if (!sCoCode ||
				!sId ||
				!sBank ||
				!sPrincipal ||
				sLien === "" ||
				!sRate ||
				!oData.start ||
				!sTenor ||
				!oData.freq ||
				!sOpeningFd ||
				!oData.glP ||
				!oData.bankGL ||
				!oData.glI ||
				!oData.glInc ||
				!sProfitCenter
			) {
				oLegacyModel.setProperty("/message", "Please fill all required fields including Lien Amount.");
				MessageBox.error("Please fill all mandatory fields including Lien Amount.");
				return;
			}

			var fPrincipalVal = Number(sPrincipal);
			var fLienVal = Number(sLien);

			if (isNaN(fLienVal) || fLienVal < 0) {
				oLegacyModel.setProperty("/lienValueState", "Error");
				oLegacyModel.setProperty("/lienValueStateText", "Lien Amount must be non-negative.");
				MessageBox.error("Lien Amount must be non-negative.");
				return;
			}

			if (fLienVal > fPrincipalVal) {
				oLegacyModel.setProperty("/lienValueState", "Error");
				oLegacyModel.setProperty("/lienValueStateText", "Lien Amount cannot exceed Principal Amount.");
				MessageBox.error("Lien Amount must not exceed Principal Amount.");
				return;
			}

			var fNotLienVal = fPrincipalVal - fLienVal;
			oLegacyModel.setProperty("/lienValueState", "None");
			oLegacyModel.setProperty("/lienValueStateText", "");
			oLegacyModel.setProperty("/notLienAmt", fNotLienVal);

			oLegacyModel.setProperty("/message", "Posting accounting document...");
			oLegacyModel.setProperty("/fdDocNo", "");

			var oPayload = {
				CoCode: sCoCode,
				FdAccno: sId,
				BankName: sBank,
				PrincipalAmt: sPrincipal,
				InterestRate: sRate,
				StartDate: this._toODataDateTime(oData.start),
				CREATE_DATE: this._toODataDateTime(oData.createDate),
				TenorMonths: sTenor,
				CompoundFreq: this._compoundFreqText(oData.freq),
				OPENING_FD: sOpeningFd,
				GlPrincipal: this.padTo10(oData.glP),
				BankGl: this.padTo10(oData.bankGL),
				GlReceivable: this.padTo10(oData.glI),
				GlIncome: this.padTo10(oData.glInc),
				ProfitCenter: this.padTo10(sProfitCenter),
				MATURITY_DATE: this._toODataDateTime(oData.maturityDate)
			};

			var aFdProps = this._getFdDetailsProperties(oServiceModel);
			if (aFdProps && aFdProps.length > 0) {
				aFdProps.forEach(function(sProp) {
					var sUp = sProp.toUpperCase().replace(/[^A-Z]/g, "");
					if (sUp === "LIENAMT" || sUp === "LIEN") {
						oPayload[sProp] = String(fLienVal);
					} else if (sUp === "NOTLIENAMT" || sUp === "NOTLIEN") {
						oPayload[sProp] = String(fNotLienVal);
					}
				});
			} else {
				oPayload.LIEN_AMT = String(fLienVal);
				oPayload.NOT_LIEN_AMT = String(fNotLienVal);
				oPayload.LienAmt = String(fLienVal);
				oPayload.NotLienAmt = String(fNotLienVal);
			}

			if (sId) {
				try {
					window.localStorage.setItem("FD_LIEN_" + sId, String(fLienVal));
					window.localStorage.setItem("FD_NOT_LIEN_" + sId, String(fNotLienVal));
				} catch (e) {}
			}

			oLegacyModel.setProperty("/message", "Posting Legacy FD...");

			console.log("========== LEGACY FD PAYLOAD ==========");
			console.log("StartDate:", oPayload.StartDate);
			console.log("TenorMonths:", oPayload.TenorMonths);
			console.log("MATURITY_DATE:", oPayload.MATURITY_DATE);
			console.log(oPayload);

			FdDetailsService.createLegacyFd(oServiceModel, oPayload, {

				success: function(oResponse) {

					var sDocNo = oResponse && oResponse.FdDocNo ? oResponse.FdDocNo : "";

					if (sDocNo && oData.maturityDate) {
						var sMaturityKey = "FD_MATURITY_" + sDocNo;
						var sIso = this._dateToIso(oData.maturityDate);
						if (sIso) {
							try {
								window.localStorage.setItem(sMaturityKey, sIso);
							} catch (e) {}
						}
					}

					MessageToast.show("Legacy FD Posted Successfully");

					this._resetModelProperties(
						oLegacyModel,
						this._defaultLegacyFd("Legacy FD Posted Successfully")
					);

					// set doc number after the reset, otherwise the default
					// model (which also clears fdDocNo) would wipe it out
					if (sDocNo) {
						oLegacyModel.setProperty("/fdDocNo", sDocNo);
					}

					this._loadFdDetailsFromService();

					this._refresh();

				}.bind(this),

				error: function(oError) {

					var sMessage = this._extractODataError(oError);

					oLegacyModel.setProperty("/message", sMessage);

					MessageBox.error(sMessage);

				}.bind(this)

			});
		},

		onOpenMaturity: function(oEvent) {
			var oFd = this._getObjectFromEvent(oEvent);
			this._showMaturityDialog(oFd);
		},

		onOpenAlertMaturity: function(oEvent) {
			var oAlert = this._getObjectFromEvent(oEvent);
			var oFd = this._fds.filter(function(oItem) {
				return oItem.id === oAlert.fdId;
			})[0];
			this._showMaturityDialog(oFd);
		},
		onRefreshFDTable: function() {

			this._loadFdDetailsFromService();
			MessageToast.show("Refreshing...");

		},
		onRunMonthEnd: function() {
			MessageBox.success(
				"Month-end run complete.\n\nInterest accrual entries posted for active FDs.\nPrevious month reversals posted on the first day.\nMaturity alerts refreshed.\n\nTotal accrual posted: " +
				this.getView().getModel().getProperty("/metrics/accruedInterest"));
		},

		onSaveSettings: function() {
			MessageToast.show("Settings saved");
		},

		_showMaturityDialog: function(oFd) {
			if (!oFd) {
				return;
			}

			var fMaturity = this._maturityValue(oFd);
			var fInterest = fMaturity - oFd.principal;
			var sDetails = [
				oFd.bank + " | Maturity date: " + oFd.maturityText,
				"Principal: " + oFd.principalText,
				"Maturity value: " + this._fmt(fMaturity),
				"",
				"Accounting entries to post:",
				"Dr Bank A/c (" + oFd.glP + ") " + this._fmt(fMaturity),
				"Cr FD principal (" + oFd.glP + ") " + this._fmt(oFd.principal),
				"Cr Interest receivable (" + oFd.glI + ") " + this._fmt(fInterest)
			].join("\n");

			MessageBox.show(sDetails, {
				title: "Maturity processing - " + oFd.id,
				actions: ["Encash", "Renew principal", "Renew with interest", MessageBox.Action.CANCEL],
				onClose: function(sAction) {
					if (sAction === MessageBox.Action.CANCEL) {
						return;
					}
					this._processMaturity(oFd.id, sAction);
				}.bind(this)
			});
		},

		_processMaturity: function(sId, sAction) {
			var oFd = this._fds.filter(function(oItem) {
				return oItem.id === sId;
			})[0];
			if (!oFd) {
				return;
			}

			oFd.status = sAction === "Encash" ? "matured" : "renewed";
			this._entries.push({
				doc: "DOC-" + sId.split("-").pop(),
				date: this._dateToIso(new Date()),
				type: "Maturity",
				fd: sId,
				gl: oFd.glP,
				drcr: "Dr",
				amount: this._maturityValue(oFd),
				text: sAction + " processed"
			});
			this._refresh();
			MessageToast.show(sId + " " + (sAction === "Encash" ? "encashed" : "renewed") + " successfully");
		},

		_setPage: function(sPage) {
			var mRoutes = {
				dashboard: "dashboard",
				fds: "fixedDeposits",
				interest: "interestAccrual",
				maturity: "maturity",
				maturityAlerts: "maturityAlerts",
				maturityCalendar: "maturityCalendar",
				accounting: "accountingEntries",
				monthEnd: "monthEnd",
				newfd: "newFD",
				legacyfd: "legacyFD",
				autoRenewal: "autoRenewal",
				settings: "settings"
			};
			this._applyUiState(sPage);
			if (this.getOwnerComponent && this.getOwnerComponent().getRouter) {
				this.getOwnerComponent().getRouter().navTo(mRoutes[sPage] || "dashboard");
			}
		},

		_refresh: function() {

			var oModel = this.getView().getModel();
			var oData = this._buildAppData();

			console.log("===== DASHBOARD DATA =====");
			console.log("FD Count:", oData.fds.length);
			console.table(oData.fds);

			Object.keys(oData).forEach(function(sPath) {
				oModel.setProperty("/" + sPath, oData[sPath]);
			});

			// Table binding is filtered client-side (search/quick filter/dialog/KPI),
			// so re-apply that filter state whenever the underlying data is rebuilt -
			// otherwise a refresh would silently drop the active filter.
			this._applyTableFilters();
			if (this._applyAutoRenewalFilters) {
				this._applyAutoRenewalFilters();
			}

		},
		_loadFdDetailsFromService: function() {

			BusyIndicator.show(0);

			var oServiceModel = this.getOwnerComponent().getModel();

			if (!oServiceModel || !oServiceModel.read) {
				BusyIndicator.hide();
				this._setLoadState("OData model is not available.", "Error");
				return;
			}

			FdDetailsService.readFdDetails(oServiceModel, {

				success: function(oData) {

					BusyIndicator.hide();

					var aResults = oData.results || [];

					this._fds = aResults.map(this._mapFdDetailsEntity.bind(this));

					this._entries = [];

					this._setLoadState(
						"Loaded " + aResults.length + " records from FdDetailsSet.",
						"Success",
						false
					);

					this._refresh();

				}.bind(this),

				error: function() {

					BusyIndicator.hide();

					this._setLoadState(
						"Could not load FdDetailsSet.",
						"Error"
					);

				}.bind(this)

			});

		},

		_setLoadState: function(sMessage, sState, bToast) {
			this._loadState = {
				status: sMessage,
				state: sState
			};
			this._refresh();
			if (bToast) {
				MessageToast.show(sMessage);
			}
		},

		// ---------- Active FDs table filter engine ----------

		// Combines free-text search, the quick-filter chip, the filter
		// dialog's checkboxes, and a KPI click-through filter into one
		// client-side filter on the fdTable binding.
		_applyTableFilters: function() {
			var oTable = this.byId("fdTable");
			var oBinding = oTable && oTable.getBinding("items");

			if (!oBinding) {
				return;
			}

			var oState = this._tableFilters;
			var aFilters = [];

			if (oState.search) {
				aFilters.push(new Filter({
					filters: [
						new Filter("id", FilterOperator.Contains, oState.search),
						new Filter("bank", FilterOperator.Contains, oState.search),
						new Filter("fdDocNoText", FilterOperator.Contains, oState.search),
						new Filter("renewalDocNoText", FilterOperator.Contains, oState.search),
						new Filter("statusText", FilterOperator.Contains, oState.search)
					],
					and: false
				}));
			}

			if (oState.quick && oState.quick !== "all") {
				aFilters.push(this._statusOrAutoRenewFilter(oState.quick));
			}

			if (oState.statusChecks && oState.statusChecks.length) {
				aFilters.push(new Filter({
					filters: oState.statusChecks.map(this._statusOrAutoRenewFilter.bind(this)),
					and: false
				}));
			}

			if (oState.kpi) {
				aFilters.push(new Filter(oState.kpi, FilterOperator.EQ, true));
			}

			oBinding.filter(aFilters);
		},

		// "autoRenew" is a boolean flag on the FD, everything else
		// (active/matured/renewed) is a value of the "status" field.
		_statusOrAutoRenewFilter: function(sKey) {
			return sKey === "autoRenew" ?
				new Filter("autoRenew", FilterOperator.EQ, true) :
				new Filter("status", FilterOperator.EQ, sKey);
		},

		// ---------- KPI-tile click-through filtering ----------

		_attachKpiCardHandlers: function() {
			var mHandlers = {
				fdCorpusCard: this._filterByQuickKey.bind(this, "active"),
				fdAccruedCard: this._filterByQuickKey.bind(this, "active"),
				fdMaturingCard: this._filterByKpi.bind(this, "maturingThisMonth"),
				fdAutoRenewCard: this._filterByKpi.bind(this, "autoRenew"),
				fdMonthEndCard: this.onNavMonthEnd.bind(this)
			};

			Object.keys(mHandlers).forEach(function(sId) {
				var oCard = this.byId(sId);
				if (oCard) {
					oCard.attachBrowserEvent("click", mHandlers[sId]);
				}
			}.bind(this));
		},

		_filterByQuickKey: function(sKey) {
			this._tableFilters.kpi = null;
			this._tableFilters.quick = sKey;
			this._syncQuickFilterChip(sKey);
			this._applyTableFilters();
		},

		_filterByKpi: function(sProperty) {
			this._tableFilters.kpi = sProperty;
			this._tableFilters.quick = "all";
			this._syncQuickFilterChip("all");
			this._applyTableFilters();
		},

		_syncQuickFilterChip: function(sKey) {
			var oUiModel = this.getView().getModel("ui");
			if (oUiModel) {
				oUiModel.setProperty("/quickFilter", sKey);
			}
		},

		_openValueHelp: function(oConfig) {

			// Defensive guard: these are normally set up in
			// initializeApplication(), but if that hasn't run yet for any
			// reason (e.g. onInit not wired up, or a race on first click)
			// this stops "Cannot read properties of undefined" errors and
			// self-heals instead of crashing.
			this._f4Cache = this._f4Cache || {};
			this._f4Dialogs = this._f4Dialogs || {};

			var sKey = oConfig.entitySet;
			var sDescProp = oConfig.descriptionProperty || oConfig.titleProperty;

			var fnFilter = function(oEvent) {
				var sValue = oEvent.getParameter("value");
				var aFilters = [];
				if (sValue) {
					aFilters.push(new Filter({
						filters: [
							new Filter(oConfig.titleProperty, FilterOperator.Contains, sValue),
							new Filter(sDescProp, FilterOperator.Contains, sValue)
						],
						and: false
					}));
				}
				oEvent.getSource().getBinding("items").filter(aFilters);
			};

			// Dialog already exists → reset any stale search/filter, then reopen
			if (this._f4Dialogs[sKey]) {

				this._f4Dialogs[sKey]._config = oConfig;

				var oExistingBinding = this._f4Dialogs[sKey].getBinding("items");
				if (oExistingBinding) {
					oExistingBinding.filter([]);
				}
				if (this._f4Dialogs[sKey].setSearchValue) {
					this._f4Dialogs[sKey].setSearchValue("");
				}

				this._f4Dialogs[sKey].open();

				return;
			}

			var oServiceModel = this.getOwnerComponent().getModel();

			if (!oServiceModel || !oServiceModel.read) {
				MessageBox.error("OData model is not available.");
				return;
			}

			var fnCreateDialog = function(aResults) {

				var oDialog = new SelectDialog({

					title: oConfig.title,

					growing: true,
					growingThreshold: 50,

					search: fnFilter,
					liveChange: fnFilter,

					confirm: function(oEvent) {

						var oSelectedItem = oEvent.getParameter("selectedItem");

						if (!oSelectedItem) {
							return;
						}

						var oData = oSelectedItem.getBindingContext().getObject();

						var oModel = this.getView().getModel(
							oDialog._config.modelName || "newFd"
						);

						// Populate the main field
						oModel.setProperty(
							oDialog._config.targetPath,
							oData[oDialog._config.valueProperty || oDialog._config.titleProperty] || ""
						);

						// Populate additional fields if configured
						if (oDialog._config.additionalMappings) {

							oDialog._config.additionalMappings.forEach(function(oMap) {

								oModel.setProperty(
									oMap.target,
									oData[oMap.source] || ""
								);

							});

						}

					}.bind(this)

				});

				oDialog.setModel(new JSONModel({
					items: aResults
				}));
				oDialog.bindAggregation("items", {
					path: "/items",
					template: new StandardListItem({
						title: "{" + oConfig.titleProperty + "}",
						description: oConfig.descriptionProperty ? "{" + oConfig.descriptionProperty + "}" : ""
					})
				});

				oDialog._config = oConfig;

				this.getView().addDependent(oDialog);

				this._f4Dialogs[sKey] = oDialog;

				oDialog.open();

			}.bind(this);

			// Already cached → don't call backend
			if (this._f4Cache[sKey]) {

				fnCreateDialog(this._f4Cache[sKey]);

				return;

			}

			// First time only
			BusyIndicator.show(0);

			oServiceModel.read(sKey, {

				success: function(oData) {

					BusyIndicator.hide();

					var aResults = oData.results || [];

					this._f4Cache[sKey] = aResults;

					fnCreateDialog(aResults);

				}.bind(this),

				error: function(oError) {

					sap.ui.core.BusyIndicator.hide();

					MessageBox.error(this._extractODataError(oError));

				}.bind(this)

			});

		},

		_mapFdDetailsEntity: function(oEntity) {

			console.log("========== RETURNED FD FROM SAP ==========");
			console.log("SAP MaturityDate:", oEntity.MaturityDate || oEntity.MATURITY_DATE);
			console.log("SAP StartDate:", oEntity.StartDate || oEntity.START_DATE);
			console.log("SAP TenorMonths:", oEntity.TenorMonths || oEntity.TENOR_MONTHS);

			console.log("FD Entity:", oEntity);
			console.log("Available Properties:", Object.keys(oEntity));
			console.log("CREATE_DATE:", oEntity.CREATE_DATE);
			console.log("CreateDate:", oEntity.CreateDate);

			var iTenor = parseFloat(oEntity.TenorMonths || oEntity.TENOR_MONTHS) || 0;

			var oCreateDate =
				oEntity.CREATE_DATE ||
				oEntity.CreateDate ||
				oEntity.create_date;

			if (!oCreateDate || oCreateDate === "00000000" || oCreateDate === "0000-00-00" || (typeof oCreateDate === "string" && oCreateDate.indexOf(
					"Date(0)") > -1)) {
				oCreateDate = oEntity.StartDate || oEntity.START_DATE || new Date();
			}

			var oMaturityDateOData = oEntity.MaturityDate || oEntity.MATURITY_DATE || oEntity.maturity_date || "";

			var oRenewalDateRaw = oEntity.RenewalDate || oEntity.RENEWAL_DATE || oEntity.renewal_date;
			var sRenewalDateIso = "";
			if (oRenewalDateRaw && oRenewalDateRaw !== "00000000" && oRenewalDateRaw !== "0000-00-00" && (typeof oRenewalDateRaw !== "string" ||
					oRenewalDateRaw.indexOf("Date(0)") === -1)) {
				sRenewalDateIso = this._dateToIso(this._parseODataDate(oRenewalDateRaw));
			}

			var sId = oEntity.FdAccno || oEntity.FD_ACCNO;
			var fPrincipal = this._parseNumber(oEntity.PrincipalAmt || oEntity.PRINCIPAL_AMT);
			var fLien = this._parseNumber(
				oEntity.LienAmt !== undefined ? oEntity.LienAmt :
				oEntity.LIEN_AMT !== undefined ? oEntity.LIEN_AMT :
				oEntity.lien_amt !== undefined ? oEntity.lien_amt : 0
			);
			if (!fLien && sId) {
				try {
					var sCached = window.localStorage.getItem("FD_LIEN_" + sId);
					if (sCached) {
						fLien = Number(sCached) || 0;
					}
				} catch (e) {}
			}
			var fNotLien = this._parseNumber(
				oEntity.NotLienAmt !== undefined && Number(oEntity.NotLienAmt) > 0 ? oEntity.NotLienAmt :
				oEntity.NOT_LIEN_AMT !== undefined && Number(oEntity.NOT_LIEN_AMT) > 0 ? oEntity.NOT_LIEN_AMT :
				oEntity.not_lien_amt !== undefined && Number(oEntity.not_lien_amt) > 0 ? oEntity.not_lien_amt : 0
			);
			if (!fNotLien && sId) {
				try {
					var sNotLienCached = window.localStorage.getItem("FD_NOT_LIEN_" + sId);
					if (sNotLienCached) {
						fNotLien = Number(sNotLienCached) || 0;
					}
				} catch (e) {}
			}
			if (fNotLien <= 0 && fPrincipal > 0) {
				fNotLien = Math.max(0, fPrincipal - fLien);
			}

			var oFd = {
				id: sId,
				coCode: oEntity.CoCode || oEntity.CO_CODE,
				bank: oEntity.BankName || oEntity.BANK_NAME,
				principal: fPrincipal,
				lienAmt: fLien,
				notLienAmt: fNotLien,
				rate: this._parseNumber(oEntity.InterestRate || oEntity.INTEREST_RATE),
				start: this._dateToIso(this._parseODataDate(oEntity.StartDate || oEntity.START_DATE)),
				tenor: iTenor,
				freq: this._parseCompoundFreq(oEntity.CompoundFreq || oEntity.COMPOUND_FREQ),
				openingFd: oEntity.OPENING_FD || oEntity.OpeningFd,
				autoRenew: this._parseBoolean(oEntity.AutoRenew || oEntity.AUTO_RENEW),
				rollInterest: this._parseBoolean(oEntity.RollInterest || oEntity.ROLL_INTEREST),
				status: "active",
				glP: oEntity.GlPrincipal || oEntity.GL_PRINCIPAL,
				bankGL: oEntity.BankGl || oEntity.BANK_GL,
				glI: oEntity.GlReceivable || oEntity.GL_RECEIVABLE,
				glInc: oEntity.GlIncome || oEntity.GL_INCOME,
				profitCenter: oEntity.ProfitCenter || oEntity.PROFIT_CENTER,
				fdDocNo: oEntity.FD_DOC_NO || oEntity.FdDocNo,
				fdRevNo: oEntity.FD_REV_NO || oEntity.FdRevNo,
				creationDate: oCreateDate ? this._dateToIso(this._parseODataDate(oCreateDate)) : "",
				maturityDateOData: oMaturityDateOData,
				renewalDocNo: oEntity.RenewalDocNo || oEntity.RENEWAL_DOC_NO || oEntity.renewal_doc_no || "",
				renewalDate: sRenewalDateIso,
				renewalAmt: this._parseNumber(oEntity.RenewalAmt || oEntity.RENEWAL_AMT || oEntity.renewal_amt || 0)
			};

			// _maturityDate() can legitimately return null (missing/unparseable
			// start date) - guard it here instead of assuming a Date comes back.
			var oMaturity = this._maturityDate(oFd);
			oFd.status = (oMaturity && oMaturity < new Date()) ? "matured" : "active";

			return oFd;
		},

		_applyUiState: function(sPage) {
			var oUiModel = this.getView().getModel("ui");
			var oState = this._buildUiState(sPage);
			Object.keys(oState).forEach(function(sPath) {
				oUiModel.setProperty("/" + sPath, oState[sPath]);
			});
		},

		_buildUiState: function(sPage) {
			var mTitles = {
				dashboard: "Dashboard",
				fds: "Fixed Deposits",
				interest: "Interest Accrual",
				maturity: "Maturity Alerts",
				accounting: "Accounting Entries",
				monthEnd: "Run Month End Activity",
				newfd: "New Fixed Deposit",
				legacyfd: "Legacy FD Posting",
				settings: "Settings"
			};
			var oVisible = {};
			var oNav = {};
			Object.keys(mTitles).forEach(function(sKey) {
				oVisible[sKey] = sKey === sPage;
				oNav[sKey] = sKey === sPage ? "Emphasized" : "Transparent";
			});

			var oExistingUiModel = this.getView() && this.getView().getModel("ui");

			return {
				title: mTitles[sPage] || "Dashboard",
				visible: oVisible,
				nav: oNav,
				fdFilter: oExistingUiModel ? oExistingUiModel.getProperty("/fdFilter") || "all" : "all",
				acctFilter: oExistingUiModel ? oExistingUiModel.getProperty("/acctFilter") || "all" : "all",
				quickFilter: oExistingUiModel ? oExistingUiModel.getProperty("/quickFilter") || "all" : "all",
				fiscalYearText: this._getCurrentFiscalYearText()
			};
		},

		// Our system follows fiscal year variant V3 (1 April - 31 March):
		// Jan/Feb/Mar fall in the fiscal year that started the previous
		// calendar April, everything else starts the fiscal year in the
		// current calendar April. Always derived from today's date, so the
		// topbar never needs a manual yearly update.
		_getCurrentFiscalYearText: function() {
			var oToday = new Date();
			var iYear = oToday.getFullYear();
			var iMonth = oToday.getMonth(); // 0 = January
			var iFiscalStartYear = iMonth >= 3 ? iYear : iYear - 1;
			var sEndYearSuffix = String((iFiscalStartYear + 1) % 100).padStart(2, "0");
			return "FY " + iFiscalStartYear + "-" + sEndYearSuffix;
		},

		_buildAppData: function(oCustomDate) {
			var oAsOfDate = this._startOfDay(oCustomDate || this._asOfDate || new Date());
			var oToday = this._startOfDay(new Date());
			var bIsHistorical = oAsOfDate.getTime() !== oToday.getTime();
			var sAsOfDateFormatted = this._fmtDate(oAsOfDate);

			// filter(Boolean) belts-and-braces the map: _decorateFd() already
			// catches and logs per-record failures and returns null for a bad
			// FD instead of throwing, so one malformed record can't take down
			// the whole dashboard/table.
			var aFds = this._fds.map(function(oFd) {
				return this._decorateFd(oFd, oAsOfDate);
			}.bind(this)).filter(Boolean);

			var aEntries = this._entries.map(this._decorateEntry.bind(this));
			var sFdFilter = this.getView() && this.getView().getModel("ui") ? this.getView().getModel("ui").getProperty("/fdFilter") || "all" :
				"all";
			var sAcctFilter = this.getView() && this.getView().getModel("ui") ? this.getView().getModel("ui").getProperty("/acctFilter") ||
				"all" : "all";
			var aActive = aFds.filter(function(oFd) {
				return oFd.status === "active";
			});
			// Problem: Dashboard portfolio KPIs excluded deposits already marked Renewed.
			// Keep aActive active-only for charts and workflows; use this set for KPI totals.
			var aActiveAndRenewed = aFds.filter(function(oFd) {
				return oFd.status === "active" || oFd.status === "renewed";
			});
			var fKpiCorpus = aActiveAndRenewed.reduce(function(iSum, oFd) {
				return iSum + oFd.principal;
			}, 0);
			var fKpiLienCorpus = aActiveAndRenewed.reduce(function(iSum, oFd) {
				return iSum + (oFd.lienAmt || 0);
			}, 0);
			var fKpiNotLienCorpus = aActiveAndRenewed.reduce(function(iSum, oFd) {
				return iSum + (oFd.notLienAmt || 0);
			}, 0);
			var fKpiAccrued = aActiveAndRenewed.reduce(function(iSum, oFd) {
				return iSum + oFd.currentMonthAccrual;
			}, 0);
			var fCorpus = aActive.reduce(function(iSum, oFd) {
				return iSum + oFd.principal;
			}, 0);
			var fLienCorpus = aActive.reduce(function(iSum, oFd) {
				return iSum + (oFd.lienAmt || 0);
			}, 0);
			var fNotLienCorpus = aActive.reduce(function(iSum, oFd) {
				return iSum + (oFd.notLienAmt || 0);
			}, 0);
			var fAccrued = aActive.reduce(function(iSum, oFd) {
				return iSum + oFd.currentMonthAccrual;
			}, 0);

			var aAutoRenewalFds = aFds.filter(function(oFd) {
				if (!oFd || !oFd.id) return false;
				if (oFd.renewalDocNo || oFd.status === "renewed") return false;
				return true;
			}.bind(this)).sort(function(a, b) {
				var oDateA = this._maturityDate(a);
				var oDateB = this._maturityDate(b);
				if (oDateA && oDateB) return oDateA.getTime() - oDateB.getTime();
				if (oDateA) return -1;
				if (oDateB) return 1;
				return 0;
			}.bind(this));

			var mRenewalMonthsMap = {};
			aAutoRenewalFds.forEach(function(oFd) {
				if (oFd.maturityMonthKey && oFd.maturityMonthText) {
					mRenewalMonthsMap[oFd.maturityMonthKey] = oFd.maturityMonthText;
				}
			});
			var oCurrentDate = oAsOfDate;
			var iCurYear = oCurrentDate.getFullYear();
			var iCurMonth = oCurrentDate.getMonth() + 1;
			var sCurMonthKey = iCurYear + "-" + (iCurMonth < 10 ? "0" + iCurMonth : iCurMonth);
			if (!mRenewalMonthsMap[sCurMonthKey]) {
				mRenewalMonthsMap[sCurMonthKey] = this._fmtMonthYear(oCurrentDate);
			}

			var aRenewalMonthKeys = Object.keys(mRenewalMonthsMap).sort();
			var aRenewalMonths = [{
				key: "all",
				text: "All Months"
			}];
			aRenewalMonthKeys.forEach(function(sKey) {
				aRenewalMonths.push({
					key: sKey,
					text: mRenewalMonthsMap[sKey]
				});
			});

			var oExistingModel = this.getView() && this.getView().getModel();
			var sExistingMonthKey = oExistingModel ? oExistingModel.getProperty("/selectedRenewalMonthKey") || "all" : "all";
			var sExistingMonthText = "All Months";
			if (sExistingMonthKey !== "all" && mRenewalMonthsMap[sExistingMonthKey]) {
				sExistingMonthText = mRenewalMonthsMap[sExistingMonthKey];
			}

			return {
				loadStatus: this._loadState.status,
				loadStatusState: this._loadState.state,
				fds: aFds,
				filteredFds: sFdFilter === "all" ? aFds : aFds.filter(function(oFd) {
					return oFd.status === sFdFilter;
				}),
				interestSchedule: aActive,
				alerts: this._buildAlerts(aFds),
				accountingEntries: aEntries,
				accrualEntries: aEntries.filter(function(oEntry) {
					return oEntry.type === "Accrual" || oEntry.type === "Reversal";
				}).slice(0, 8),
				filteredEntries: sAcctFilter === "all" ? aEntries : aEntries.filter(function(oEntry) {
					return oEntry.type.toLowerCase() === sAcctFilter;
				}),
				metrics: {
					// Problem: Principal KPI previously summed active deposits only.
					// totalCorpus: this._fmt(fCorpus),
					totalCorpus: this._fmt(fKpiCorpus),
					totalLien: this._fmt(fLienCorpus),
					totalNotLien: this._fmt(fNotLienCorpus),
					// Problem: Accrued-interest KPI previously summed active deposits only.
					// accruedInterest: this._fmt(fAccrued),
					accruedInterest: this._fmt(fKpiAccrued),
					// Problem: Deposit count previously omitted renewed deposits; the long label also wrapped in the KPI card.
					// activeCount: aActive.length + " active deposit" + (aActive.length === 1 ? "" : "s"),
					activeCount: aActiveAndRenewed.length + " active deposit" + (aActiveAndRenewed.length === 1 ? "" : "s"),
					// Problem: Count descriptor previously said Active when renewed records were excluded.
					// activeCountSubText: bIsHistorical ? ("Active on " + sAsOfDateFormatted) : "Active",
					activeCountSubText: bIsHistorical ? ("Active or renewed on " + sAsOfDateFormatted) : "Active and renewed",
					// Problem: Principal KPI descriptor omitted the renewed records now included.
					// totalCorpusSubText: bIsHistorical ? ("As of " + sAsOfDateFormatted) : "Across active FDs",
					totalCorpusSubText: bIsHistorical ? ("As of " + sAsOfDateFormatted) : "Across active and renewed FDs",
					accruedInterestPeriod: bIsHistorical ? ("Month to " + sAsOfDateFormatted) : "Current Month",
					// Problem: Average-rate descriptor omitted the renewed records now included.
					// avgRateSubText: bIsHistorical ? ("As of " + sAsOfDateFormatted) : "Across active FDs",
					avgRateSubText: bIsHistorical ? ("As of " + sAsOfDateFormatted) : "Across active and renewed FDs",
					maturingThisMonth: this._countMaturingThisMonth(aFds, oAsOfDate) + " FDs",
					autoRenewCount: aActive.filter(function(oFd) {
						return oFd.autoRenew;
					}).length + " FDs",
					// Month-end always closes the current calendar month, so
					// this tells the user, before they even click "Run
					// month-end", which month's validation/posting will
					// actually happen if they run it right now.
					monthEndMonthText: this._fmtMonthYear(oAsOfDate)
				},
				bankAllocation: this._buildBankAllocation(aActive, fCorpus),
				lienAllocation: this._buildLienAllocation(aActive, fCorpus),
				rateComparison: this._buildRateComparison(aActive),
				upcomingEvents: this._buildUpcomingEvents(aFds, oAsOfDate),
				autoRenewalFds: aAutoRenewalFds,
				renewalMonths: aRenewalMonths,
				selectedRenewalMonthKey: sExistingMonthKey,
				selectedRenewalMonthText: sExistingMonthText,

				// As of Date snapshot properties
				asOfDate: oAsOfDate,
				asOfDateText: this._dateToIso(oAsOfDate),
				asOfDateFormatted: sAsOfDateFormatted,
				isHistoricalDate: bIsHistorical,

				// Auto Renewal KPI fields
				currentMonthYearText: this._fmtMonthYear(oAsOfDate),
				maturingThisMonth: this._countMaturingThisMonth(aFds, oAsOfDate),
				// Problem: Fixed Deposits principal KPI excluded renewed deposits.
				// totalFdCorpus: this._fmt(fCorpus),
				totalFdCorpus: this._fmt(fKpiCorpus),
				// Problem: Fixed Deposits lien KPI excluded renewed deposits.
				// totalLienCorpus: this._fmt(fLienCorpus),
				totalLienCorpus: this._fmt(fKpiLienCorpus),
				// Problem: Fixed Deposits available-balance KPI excluded renewed deposits.
				// totalNotLienCorpus: this._fmt(fNotLienCorpus),
				totalNotLienCorpus: this._fmt(fKpiNotLienCorpus),
				avgInterestRate: (function() {
					// Problem: Fixed Deposits average-rate KPI used active-only values.
					// var fTotalPrincipal = aActive.reduce(function(sum, fd) { return sum + Number(fd.principal || 0); }, 0);
					var fTotalPrincipal = aActiveAndRenewed.reduce(function(sum, fd) {
						return sum + Number(fd.principal || 0);
					}, 0);
					// var fTotalInterest = aActive.reduce(function(sum, fd) {
					//	var p = Number(fd.principal || 0);
					//	var r = Number(fd.rate || 0);
					//	var i = (fd.interest !== undefined && !isNaN(parseFloat(fd.interest)) && parseFloat(fd.interest) > 0) ? parseFloat(fd.interest) : (p * r) / 100;
					//	return sum + i;
					// }, 0);
					var fTotalInterest = aActiveAndRenewed.reduce(function(sum, fd) {
						var p = Number(fd.principal || 0);
						var r = Number(fd.rate || 0);
						var i = (fd.interest !== undefined && !isNaN(parseFloat(fd.interest)) && parseFloat(fd.interest) > 0) ? parseFloat(fd.interest) :
							(p * r) / 100;
						return sum + i;
					}, 0);
					return fTotalPrincipal > 0 ? ((fTotalInterest / fTotalPrincipal) * 100).toFixed(2) : "0.00";
				})(),
				// Problem: Next-maturity KPI searched active deposits only.
				// nextMaturityDate: aActive.length > 0 ? this._fmtDate(
				//	aActive.map(function(fd) { return this._maturityDate(fd); }.bind(this))
				//		.filter(function(d) { return d && d.getTime() > oAsOfDate.getTime(); })
				//		.sort(function(a, b) { return a.getTime() - b.getTime(); })[0]
				// ) : "N/A",
				nextMaturityDate: aActiveAndRenewed.length > 0 ? this._fmtDate(
					aActiveAndRenewed.map(function(fd) {
						return this._maturityDate(fd);
					}.bind(this))
					.filter(function(d) {
						return d && d.getTime() > oAsOfDate.getTime();
					})
					.sort(function(a, b) {
						return a.getTime() - b.getTime();
					})[0]
				) : "N/A"
			};
		},

		// Groups active FD principal by bank so the "Bank allocation" donut
		// and its legend always add up to the same Total FD Corpus shown in
		// the KPI card above. The long tail of one-off/legacy bank entries is
		// rolled into a single "other banks" slice so the chart stays
		// readable instead of fragmenting into a dozen slivers.
		_buildBankAllocation: function(aActive, fCorpus) {
			var oGroups = {};

			aActive.forEach(function(oFd) {
				var sBank = oFd.bank || "Unknown";
				oGroups[sBank] = (oGroups[sBank] || 0) + Number(oFd.principal || 0);
			});

			var aPalette = ["#2563EB", "#10B981", "#F97316", "#8B5CF6", "#0e7c86", "#c8952b", "#EC4899"];

			var aSorted = Object.keys(oGroups).map(function(sBank) {
				return {
					bank: sBank,
					amount: oGroups[sBank]
				};
			}).sort(function(a, b) {
				return b.amount - a.amount;
			});

			var iTopN = aPalette.length - 1;
			var aTop = aSorted.slice(0, iTopN);
			var aRest = aSorted.slice(iTopN);

			if (aRest.length) {
				var fOthersAmount = aRest.reduce(function(iSum, o) {
					return iSum + o.amount;
				}, 0);
				aTop.push({
					bank: aRest.length + " other bank" + (aRest.length > 1 ? "s" : ""),
					amount: fOthersAmount
				});
			}

			return aTop.map(function(oGroup, iIndex) {
				var fPercent = fCorpus > 0 ? (oGroup.amount / fCorpus) * 100 : 0;
				return {
					bank: oGroup.bank,
					amount: oGroup.amount,
					amountInLakhs: oGroup.amount / 100000,
					amountText: this._fmtCompact(oGroup.amount),
					percent: fPercent,
					percentText: fPercent.toFixed(1) + "%",
					color: aPalette[iIndex % aPalette.length]
				};
			}.bind(this));
		},

		_buildLienAllocation: function(aActive, fCorpus) {
			var fLienSum = 0;
			var fNotLienSum = 0;
			var fTotalPrincipal = 0;

			aActive.forEach(function(fd) {
				var p = parseFloat(String(fd.principal || 0).replace(/,/g, "")) || 0;
				var l = parseFloat(String(fd.lienAmt || 0).replace(/,/g, "")) || 0;
				var nl = parseFloat(String(fd.notLienAmt !== undefined ? fd.notLienAmt : 0).replace(/,/g, "")) || 0;
				if (nl <= 0 && p > 0) {
					nl = Math.max(0, p - l);
				}
				fTotalPrincipal += p;
				fLienSum += l;
				fNotLienSum += nl;
			});

			if (fNotLienSum <= 0 && fTotalPrincipal > 0) {
				fNotLienSum = Math.max(0, fTotalPrincipal - fLienSum);
			}

			var fTotal = fLienSum + fNotLienSum;
			if (fTotal <= 0) {
				fTotal = fCorpus > 0 ? fCorpus : 1;
				fNotLienSum = fTotal;
			}

			var fNotLienPercent = (fNotLienSum / fTotal) * 100;
			var fLienPercent = (fLienSum / fTotal) * 100;

			return [{
				category: "Not Lien",
				amount: fNotLienSum,
				amountInLakhs: (fNotLienSum / 100000),
				amountText: this._fmtCompact(fNotLienSum),
				percent: fNotLienPercent,
				percentText: fNotLienPercent.toFixed(1) + "%",
				color: "#26A65B"
			}, {
				category: "Lien",
				amount: fLienSum,
				amountInLakhs: (fLienSum / 100000),
				amountText: this._fmtCompact(fLienSum),
				percent: fLienPercent,
				percentText: fLienPercent.toFixed(1) + "%",
				color: "#F89406"
			}];
		},

		// One bar per bank, showing the best rate currently on offer there -
		// so the comparison stays meaningful even when the same bank holds
		// several FDs at different rates. Sorted best-rate-first.
		_buildRateComparison: function(aActive) {
			var oBestRate = {};

			aActive.forEach(function(oFd) {
				var sBank = oFd.bank || "Unknown";
				var fRate = Number(oFd.rate || 0);
				if (oBestRate[sBank] === undefined || fRate > oBestRate[sBank]) {
					oBestRate[sBank] = fRate;
				}
			});

			return Object.keys(oBestRate).map(function(sBank, iIndex) {
					var fRate = oBestRate[sBank];
					return {
						bank: sBank,
						rate: fRate,
						rateText: fRate.toFixed(2) + "%",
						color: iIndex === 0 ? "#c8952b" : "#0e7c86"
					};
				}).sort(function(a, b) {
					return b.rate - a.rate;
				}).slice(0, 5)
				// Re-flag the winner after sorting, and re-tone the rest, so
				// the highlighted bar is always the actual highest rate.
				.map(function(oRow, iIndex) {
					oRow.color = iIndex === 0 ? "#c8952b" : "#0e7c86";
					return oRow;
				});
		},

		// Merges the two fixed month-end dates (accrual run / reversal run)
		// with the nearest upcoming FD maturities into one chronological
		// feed, so the card reads like "what happens next" rather than a
		// static checklist.
		_buildUpcomingEvents: function(aFds, oCustomDate) {
			var oToday = this._startOfDay(oCustomDate || this._asOfDate || new Date());
			var oMonthEnd = new Date(oToday.getFullYear(), oToday.getMonth() + 1, 0);
			var oReversalDay = new Date(oToday.getFullYear(), oToday.getMonth() + 1, 1);

			var aEvents = [{
				date: oMonthEnd,
				icon: "sap-icon://synchronize",
				colorClass: "fdEventTeal",
				title: "Month-end accrual run",
				subtitle: "All active FDs"
			}, {
				date: oReversalDay,
				icon: "sap-icon://undo",
				colorClass: "fdEventInfo",
				title: "Reversal run",
				subtitle: "Reversal of " + this._fmtMonthYear(oToday) + " accrual"
			}];

			aFds.filter(function(oFd) {
				return oFd.status === "active";
			}).forEach(function(oFd) {
				var oMaturity = this._maturityDate(oFd);
				var oMaturityDay = this._startOfDay(oMaturity);

				if (oMaturityDay && oMaturityDay >= oToday) {
					aEvents.push({
						date: oMaturityDay,
						icon: "sap-icon://alert",
						colorClass: "fdEventDanger",
						title: oFd.id + " FD maturity",
						subtitle: oFd.bank + " \u2022 " + oFd.principalText
					});
				}
			}.bind(this));

			return aEvents
				.sort(function(a, b) {
					return a.date - b.date;
				})
				.slice(0, 6)
				.map(function(oEvent) {
					return {
						icon: oEvent.icon,
						colorClass: oEvent.colorClass,
						title: oEvent.title,
						subtitle: oEvent.subtitle,
						dateText: this._fmtDate(oEvent.date)
					};
				}.bind(this));
		},

		// Compact Indian-numbering currency ("₹2.62Cr" / "₹73.95L" / "₹1.1K")
		// for the allocation legend, where full rupee figures next to a donut
		// chart would just be visual noise.
		_fmtCompact: function(nValue) {
			var fValue = Number(nValue) || 0;
			var fAbs = Math.abs(fValue);

			if (fAbs >= 1e7) {
				return "\u20b9" + (fValue / 1e7).toFixed(2) + "Cr";
			}
			if (fAbs >= 1e5) {
				return "\u20b9" + (fValue / 1e5).toFixed(2) + "L";
			}
			if (fAbs >= 1e3) {
				return "\u20b9" + (fValue / 1e3).toFixed(1) + "K";
			}
			return "\u20b9" + Math.round(fValue).toLocaleString("en-IN");
		},

		_buildAlerts: function(aFds) {
			var aAlerts = aFds.filter(function(oFd) {
				return oFd.status === "active";
			}).slice(0, 3).map(function(oFd, iIndex) {
				var sIcon = iIndex === 0 ? "sap-icon://alert" : iIndex === 1 ? "sap-icon://bell" : "sap-icon://hint";
				var sAction = iIndex === 0 ? "Process now" : iIndex === 1 ? "Review" : "Plan";
				return {
					fdId: oFd.id,
					icon: sIcon,
					title: oFd.id + " matures on " + oFd.maturityText,
					subtitle: oFd.bank + " | " + oFd.principalText + " | Maturity value: " + oFd.maturityValueText,
					actionText: sAction
				};
			});

			return aAlerts.length ? aAlerts : [{
				fdId: "",
				icon: "sap-icon://sys-enter-2",
				title: "No urgent maturity alerts right now.",
				subtitle: "All active deposits are outside the alert window.",
				actionText: "Done"
			}];
		},

		_decorateFd: function(oFd, oCustomDate) {

			try {

				console.log("Decorating FD :", oFd.id);

				var oCopy = Object.assign({}, oFd);
				var oAsOfDate = this._startOfDay(oCustomDate || this._asOfDate || new Date());

				var oMaturityDate = this._maturityDate(oFd);
				var fMaturity = this._maturityValue(oFd);

				oCopy.principalText = this._fmt(oFd.principal);
				oCopy.lienAmt = Number(oFd.lienAmt || 0);
				oCopy.notLienAmt = Number(oFd.notLienAmt !== undefined ? oFd.notLienAmt : (oCopy.principal - oCopy.lienAmt));
				oCopy.lienAmtText = this._fmtAmount(oCopy.lienAmt);
				oCopy.notLienAmtText = this._fmtAmount(oCopy.notLienAmt);
				oCopy.rateText = oFd.rate + "%";
				oCopy.tenorText = oFd.tenor + "M";

				oCopy.startText = oFd.start ? this._fmtDate(oFd.start) : "";
				oCopy.creationDateText = oFd.creationDate ? this._fmtDate(oFd.creationDate) : "";
				oCopy.maturityText = oMaturityDate ? this._fmtDate(oMaturityDate) : "";
				oCopy.maturityValueText = isNaN(fMaturity) ? "" : this._fmt(fMaturity);

				// FIX: these were never derived, so every view binding to
				// {fdDocNoText}, {fdRevNoText}, {statusText}, {statusState},
				// {autoRenewText}, {autoRenewIcon}, {autoRenewState} resolved
				// to undefined - including the search/export logic in
				// _applyTableFilters() and onExportFD(), which filter/export
				// on "fdDocNoText" directly.
				oCopy.fdDocNoText = oFd.fdDocNo ? oFd.fdDocNo : "Not Posted";
				oCopy.fdRevNoText = oFd.fdRevNo ? oFd.fdRevNo : "-";

				oCopy.renewalDocNoText = oFd.renewalDocNo ? oFd.renewalDocNo : "-";
				oCopy.renewalDateText = oFd.renewalDate ? this._fmtDate(oFd.renewalDate) : "-";
				oCopy.renewalAmtText = oFd.renewalAmt && Number(oFd.renewalAmt) > 0 ? this._fmt(oFd.renewalAmt) : "-";

				var oStartDate = oFd.start ? this._startOfDay(new Date(oFd.start + "T00:00:00")) : null;
				var oCreationDate = oFd.creationDate ? this._startOfDay(new Date(oFd.creationDate + "T00:00:00")) : null;
				var oMaturityDay = oMaturityDate ? this._startOfDay(oMaturityDate) : null;
				var oRenewalDay = oFd.renewalDate ? this._startOfDay(new Date(oFd.renewalDate + "T00:00:00")) : null;

				var bStarted = oStartDate ? (oStartDate <= oAsOfDate) : true;
				var bCreated = oCreationDate ? (oCreationDate <= oAsOfDate) : true;
				// var bExisted = bStarted && bCreated;
				var bExisted = bStarted; // For As Of Date field change to Start Date

				var bMatured = (oMaturityDay && oMaturityDay < oAsOfDate);
				var bRenewed = (oFd.renewalDocNo && oRenewalDay && oRenewalDay <= oAsOfDate);

				if (!bExisted) {
					oCopy.status = "future";
					oCopy.statusText = "Not Started";
					oCopy.statusState = "None";
				} else if (bMatured) {
					oCopy.status = "matured";
					oCopy.statusText = "Matured";
					oCopy.statusState = "Warning";
				} else if (bRenewed) {
					oCopy.status = "renewed";
					oCopy.statusText = "Renewed";
					oCopy.statusState = (typeof sap !== "undefined" && sap.ui && sap.ui.core && sap.ui.core.ValueState && sap.ui.core.ValueState.Information) ?
						"Information" : "None";
				} else {
					oCopy.status = "active";
					oCopy.statusText = "Active";
					oCopy.statusState = "Success";
				}

				oCopy.autoRenewText = oFd.autoRenew ? "Yes" : "No";
				oCopy.autoRenewIcon = oFd.autoRenew ? "sap-icon://accept" : "";
				oCopy.autoRenewState = oFd.autoRenew ? "Success" : "None";

				var iDaysLeft = 0;
				if (oMaturityDay && !isNaN(oMaturityDay.getTime())) {
					iDaysLeft = Math.ceil((oMaturityDay.getTime() - oAsOfDate.getTime()) / (1000 * 3600 * 24));
					if (iDaysLeft < 0) iDaysLeft = 0;

					var iMatYear = oMaturityDate.getFullYear();
					var iMatMonth = oMaturityDate.getMonth() + 1;
					oCopy.maturityMonthKey = iMatYear + "-" + (iMatMonth < 10 ? "0" + iMatMonth : iMatMonth);
					oCopy.maturityMonthText = this._fmtMonthYear(oMaturityDate);
				} else {
					oCopy.maturityMonthKey = "";
					oCopy.maturityMonthText = "";
				}
				oCopy.daysLeft = iDaysLeft;

				this._applyDaywiseAccrual(oCopy, oAsOfDate);

				return oCopy;

			} catch (e) {

				console.error("FD FAILED :", oFd.id);
				console.error(oFd);
				console.error(e);

				return null;
			}
		},
		_decorateEntry: function(oEntry) {
			var oCopy = {};
			Object.keys(oEntry).forEach(function(sKey) {
				oCopy[sKey] = oEntry[sKey];
			});
			oCopy.dateText = this._fmtDate(oEntry.date);
			oCopy.amountText = this._fmt(oEntry.amount);
			oCopy.drAmountText = oEntry.drcr === "Dr" ? this._fmt(oEntry.amount) : "-";
			oCopy.crAmountText = oEntry.drcr === "Cr" ? this._fmt(oEntry.amount) : "-";
			oCopy.entryState = oEntry.type === "Accrual" ? "Success" : oEntry.type === "Reversal" ? "Warning" : "None";
			oCopy.drcrState = oEntry.drcr === "Dr" ? "None" : "Success";
			return oCopy;
		},

		_resetModelProperties: function(oModel, oData) {
			Object.keys(oData).forEach(function(sPath) {
				oModel.setProperty("/" + sPath, oData[sPath]);
			});
		},
		_setCurrentFiscalYear: function() {

			var oDatePicker = this.byId("dpStartDate");

			if (!oDatePicker) {
				return;
			}

			var oToday = new Date();
			var iYear = oToday.getFullYear();
			var iMonth = oToday.getMonth(); // January = 0

			var oFiscalStart, oFiscalEnd;

			if (iMonth >= 3) { // April to December

				oFiscalStart = new Date(iYear, 3, 1); // 1-Apr-current year
				oFiscalEnd = new Date(iYear + 1, 2, 31); // 31-Mar-next year

			} else { // January to March

				oFiscalStart = new Date(iYear - 1, 3, 1); // 1-Apr-last year
				oFiscalEnd = new Date(iYear, 2, 31); // 31-Mar-current year

			}

			oDatePicker.setMinDate(oFiscalStart);
			oDatePicker.setMaxDate(oFiscalEnd);

		},

		_defaultNewFd: function(sMessage) {
			return {
				coCode: "",
				bank: "",
				id: "",
				principal: "",
				lienAmt: "",
				notLienAmt: "",
				lienValueState: "None",
				lienValueStateText: "",
				rate: "",
				start: "",
				createDate: this._dateToIso(new Date()),
				tenor: "",
				tenorYears: "",
				tenorMonths: "",
				tenorDays: "",
				calculatedMaturity: "",
				freq: "12",
				openingFd: "",
				autoRenew: false,
				rollInterest: false,
				glP: "",
				bankGL: "",
				glI: "",
				glInc: "",
				profitCenter: "",
				fdDocNo: "",
				message: sMessage || ""
			};
		},

		_defaultLegacyFd: function(sMessage) {
			return {
				coCode: "",
				bank: "",
				id: "",
				principal: "",
				lienAmt: "",
				notLienAmt: "",
				lienValueState: "None",
				lienValueStateText: "",
				rate: "",
				start: "",
				createDate: this._dateToIso(new Date()),
				tenor: "",
				tenorText: "",
				maturityDate: "",
				freq: "12",
				openingFd: "",
				glP: "",
				bankGL: "",
				glI: "",
				glInc: "",
				profitCenter: "",
				fdDocNo: "",
				message: sMessage || ""
			};
		},

		_recalculateLienAndNotLien: function(sModelName) {
			var oModel = this.getView().getModel(sModelName);
			if (!oModel) return;
			var oData = oModel.getData();
			var fPrincipal = parseFloat(String(oData.principal || "").replace(/,/g, "")) || 0;
			var sLienRaw = String(oData.lienAmt !== undefined && oData.lienAmt !== null ? oData.lienAmt : "").trim();
			var fLien = parseFloat(sLienRaw.replace(/,/g, "")) || 0;

			if (sLienRaw !== "" && fLien < 0) {
				oModel.setProperty("/lienValueState", "Error");
				oModel.setProperty("/lienValueStateText", "Lien Amount must be non-negative.");
				oModel.setProperty("/notLienAmt", "");
				return;
			}

			if (fPrincipal > 0 && sLienRaw !== "" && fLien > fPrincipal) {
				oModel.setProperty("/lienValueState", "Error");
				oModel.setProperty("/lienValueStateText", "Lien Amount cannot exceed Principal Amount.");
				oModel.setProperty("/notLienAmt", "");
				return;
			}

			oModel.setProperty("/lienValueState", "None");
			oModel.setProperty("/lienValueStateText", "");

			if (oData.principal !== "" && sLienRaw !== "") {
				var fNotLien = fPrincipal - fLien;
				oModel.setProperty("/notLienAmt", fNotLien >= 0 ? fNotLien : 0);
			} else if (oData.principal !== "" && sLienRaw === "") {
				oModel.setProperty("/notLienAmt", fPrincipal);
			}
		},

		padTo10: function(sValue) {
			if (!sValue) return "";
			var sStr = String(sValue).trim();
			var iZeros = 10 - sStr.length;
			if (iZeros > 0) {
				sStr = "0".repeat(iZeros) + sStr;
			}
			return sStr;
		},

		_compoundFreqText: function(vFreq) {
			return Frequency.toText(vFreq);
		},

		_toODataDateTime: function(sDate) {
			if (!sDate) {
				return null;
			}
			if (sDate instanceof Date) {
				// Normalize to a UTC-midnight instant carrying the same
				// calendar date as the Date's local components, so it
				// survives the backend's floor-to-UTC-day truncation.
				return new Date(Date.UTC(
					sDate.getFullYear(),
					sDate.getMonth(),
					sDate.getDate()
				));
			}
			var aParts = String(sDate).split("-");
			// IMPORTANT: use Date.UTC(), not local numeric components.
			// The backend/Gateway treats the incoming DateTime as UTC and
			// floors it to the UTC calendar day. Local midnight in IST
			// (UTC+5:30) is 18:30 the previous day in UTC, so the backend
			// was storing one day earlier. Building the instant directly
			// at UTC midnight keeps the UTC calendar day equal to the
			// date the user picked, regardless of the browser's timezone.
			return new Date(Date.UTC(
				Number(aParts[0]),
				Number(aParts[1]) - 1,
				Number(aParts[2])
			));
		},

		_extractODataError: function(oError) {
			return ODataErrorHandler.extract(oError, "FD creation failed.");
		},

		_getObjectFromEvent: function(oEvent) {
			return oEvent.getSource().getBindingContext().getObject();
		},

		_maturityDate: function(oFd) {
			if (!oFd) {
				return null;
			}

			if (oFd.maturityDateOData && oFd.maturityDateOData !== "00000000" && oFd.maturityDateOData !== "0000-00-00" && (typeof oFd.maturityDateOData !==
					"string" || oFd.maturityDateOData.indexOf("Date(0)") === -1)) {
				var oBackendMat = this._parseODataDate(oFd.maturityDateOData);
				if (oBackendMat && !isNaN(oBackendMat.getTime())) {
					return oBackendMat;
				}
			}

			if (!oFd.start) {
				return null;
			}

			var oDate;

			if (oFd.start instanceof Date) {
				oDate = new Date(oFd.start.getTime());
			} else {
				oDate = new Date(oFd.start + "T00:00:00");
			}

			if (isNaN(oDate.getTime())) {
				return null;
			}

			var fTenor = Number(oFd.tenor || 0);

			if (isNaN(fTenor)) {
				return null;
			}

			// Whole months
			var iMonths = Math.floor(fTenor);

			// Fractional month converted back to days
			var iDays = Math.round((fTenor - iMonths) * 30);

			// Apply months first
			oDate.setMonth(oDate.getMonth() + iMonths);

			// Apply remaining days
			oDate.setDate(oDate.getDate() + iDays);

			return oDate;
		},

		_maturityValue: function(oFd) {
			var fRate = Number(oFd.rate) / 100;
			var iFreq = Number(oFd.freq) || 1;
			var fYears = Number(oFd.tenor) / 12;
			return Number(oFd.principal) * Math.pow(1 + fRate / iFreq, iFreq * fYears);
		},

		_applyDaywiseAccrual: function(oFd, oCustomDate) {

			console.log("========== APPLY DAYWISE ACCRUAL ==========");

			var oToday = this._startOfDay(oCustomDate || this._asOfDate || new Date());

			if (!oToday) {
				console.error("Unable to determine today's date.");
				return;
			}

			var oMonthStart = new Date(
				oToday.getFullYear(),
				oToday.getMonth(),
				1
			);

			var oStartDate = null;
			if (oFd.start) {
				oStartDate = this._startOfDay(new Date(oFd.start + "T00:00:00"));
			}

			var oMaturityDate = this._startOfDay(this._maturityDate(oFd));

			var oCreationDate = null;
			if (oFd.creationDate) {
				oCreationDate = this._startOfDay(new Date(oFd.creationDate + "T00:00:00"));
			}

			// if (!oStartDate || !oMaturityDate || oStartDate > oToday || (oCreationDate && oCreationDate > oToday)) {
			if (!oStartDate || !oMaturityDate || oStartDate > oToday) { // For As Of Date field change to Start Date
				oFd.accruedDays = 0;
				oFd.accruedDaysText = "0 days";
				oFd.dailyAccrual = 0;
				oFd.dailyAccrualText = this._fmt(0);
				oFd.currentMonthAccrual = 0;
				oFd.currentMonthAccrualText = this._fmt(0);
				oFd.accrualPeriodText = "Not Available";
				return;
			}

			// Calculation Date is either Today or Maturity Date, whichever is earlier
			var oCalculationDate = oMaturityDate < oToday ? oMaturityDate : oToday;

			// Previous month calculation date
			var oPrevMonthEnd = new Date(oToday.getFullYear(), oToday.getMonth(), 0);
			oPrevMonthEnd = this._startOfDay(oPrevMonthEnd);
			if (oPrevMonthEnd > oMaturityDate) {
				oPrevMonthEnd = oMaturityDate;
			}

			var fPrincipal = Number(oFd.principal || 0);
			var fRate = Number(oFd.rate || 0) / 100;

			// Current Month Cumulative Calculation
			var iCumulativeDays = oCalculationDate >= oStartDate ? this._daysBetween(oStartDate, oCalculationDate) + 1 : 0;
			var fCumulativeInterest = (fPrincipal * fRate * iCumulativeDays) / 365;

			// Previous Month Cumulative Calculation
			var iPrevCumulativeDays = oPrevMonthEnd >= oStartDate ? this._daysBetween(oStartDate, oPrevMonthEnd) + 1 : 0;
			var fPrevCumulativeInterest = (fPrincipal * fRate * iPrevCumulativeDays) / 365;

			// Monthly Interest = Current Month Cumulative Interest - Previous Month Cumulative Interest
			var fCurrentMonthAccrual = fCumulativeInterest - fPrevCumulativeInterest;
			if (fCurrentMonthAccrual < 0) fCurrentMonthAccrual = 0;

			var iDays = iCumulativeDays - iPrevCumulativeDays;
			if (iDays < 0) iDays = 0;

			var fDailyAccrual = (fPrincipal * fRate) / 365;

			oFd.accruedDays = iDays;
			oFd.accruedDaysText = iDays + (iDays === 1 ? " day" : " days");

			oFd.dailyAccrual = fDailyAccrual;
			oFd.dailyAccrualText = this._fmt(fDailyAccrual);

			oFd.currentMonthAccrual = fCurrentMonthAccrual;
			oFd.currentMonthAccrualText = this._fmt(fCurrentMonthAccrual);

			var oAccrualStart = oStartDate > oMonthStart ? oStartDate : oMonthStart;
			oFd.accrualPeriodText = iDays ? this._fmtDate(oAccrualStart) + " - " + this._fmtDate(oCalculationDate) : "No accrual this month";

		},

		_startOfDay: function(oDate) {

			if (!oDate || !(oDate instanceof Date) || isNaN(oDate.getTime())) {
				return null;
			}

			return new Date(
				oDate.getFullYear(),
				oDate.getMonth(),
				oDate.getDate()
			);
		},

		_daysBetween: function(oStartDate, oEndDate) {
			return Math.floor((oEndDate.getTime() - oStartDate.getTime()) / 86400000);
		},

		_isSameMonth: function(oDateA, oDateB) {
			return oDateA.getFullYear() === oDateB.getFullYear() && oDateA.getMonth() === oDateB.getMonth();
		},

		_parseNumber: function(vValue) {
			if (vValue === null || vValue === undefined || vValue === "") {
				return 0;
			}
			return Number(String(vValue).replace(/,/g, "")) || 0;
		},

		_parseTenor: function(vValue) {
			var fTenor = parseFloat(vValue);
			if (isNaN(fTenor) || fTenor < 0) {
				return 0;
			}
			return fTenor;
		},

		_parseBoolean: function(vValue) {
			return vValue === true || vValue === "true" || vValue === "X" || vValue === "x" || vValue === "1" || vValue === 1;
		},

		_parseCompoundFreq: function(vValue) {
			return Frequency.parse(vValue);
		},

		// FIX: an empty/blank/unparseable StartDate used to fall through to
		// `new Date(vDate)`, producing an Invalid Date. That Invalid Date was
		// then truthy and passed silently into _dateToIso(), which turned it
		// into a garbage-but-truthy string like "NaN-NaN-NaN" for oFd.start.
		// That string later satisfied `!oFd.start` checks in _maturityDate(),
		// which then failed its own isNaN() guard and returned null - which
		// is what eventually crashed _countMaturingThisMonth() below.
		_parseODataDate: function(vDate) {

			var aMatch;

			if (vDate instanceof Date) {
				return vDate;
			}

			if (typeof vDate === "string" && vDate.trim()) {

				// Handles /Date(123456789)/
				aMatch = /\/Date\((\d+)\)\//.exec(vDate);

				if (aMatch) {
					return new Date(Number(aMatch[1]));
				}

				// Handles YYYYMMDD
				if (/^\d{8}$/.test(vDate)) {

					return new Date(
						parseInt(vDate.substring(0, 4), 10),
						parseInt(vDate.substring(4, 6), 10) - 1,
						parseInt(vDate.substring(6, 8), 10)
					);
				}

				var oParsed = new Date(vDate);

				if (!isNaN(oParsed.getTime())) {
					return oParsed;
				}
			}

			return new Date();
		},

		_fmt: function(nValue) {
			return Math.round(Number(nValue) || 0).toLocaleString("en-IN");
		},

		// FIX: _maturityDate() can return null for an FD with a missing or
		// unparseable start date. This used to call .getFullYear() on that
		// null unconditionally, throwing "Cannot read properties of null
		// (reading 'getFullYear')" and taking down the whole dashboard
		// metrics build. Records with no resolvable maturity date are now
		// simply excluded from the "maturing this month" count.
		_countMaturingThisMonth: function(aFds, oCustomDate) {
			var oNow = oCustomDate || this._asOfDate || new Date();
			return aFds.filter(function(oFd) {
				var oDate = this._maturityDate(oFd);
				return oDate && oDate.getFullYear() === oNow.getFullYear() && oDate.getMonth() === oNow.getMonth();
			}.bind(this)).length;
		},

		_fmtDate: function(vDate) {
			var oDate = vDate instanceof Date ? vDate : new Date(vDate + "T00:00:00");
			return oDate.toLocaleDateString("en-IN", {
				day: "2-digit",
				month: "short",
				year: "numeric"
			});
		},

		// Used by the "Month End" KPI card and the Month End History
		// table's "Month End For" column - both only need the month/year,
		// not the day.
		_fmtMonthYear: function(vDate) {
			var oDate = vDate instanceof Date ? vDate : new Date(vDate + "T00:00:00");
			if (isNaN(oDate.getTime())) {
				return "";
			}
			return oDate.toLocaleDateString("en-IN", {
				month: "short",
				year: "numeric"
			});
		},

		// _fmt() rounds to a whole number (correct for currency amounts),
		// which is wrong for rates - "2.00" was collapsing to "2". This
		// keeps exactly 2 decimal places without touching the integer part.
		_fmtRate: function(vValue) {
			if (vValue === null || vValue === undefined || vValue === "") {
				return "";
			}
			var fValue = parseFloat(String(vValue).replace(/,/g, ""));
			if (isNaN(fValue)) {
				return "";
			}
			return fValue.toFixed(2) + "%";
		},

		// _fmt() rounds to a whole number via Math.round(), which drops
		// paise/cents entirely (e.g. "1200.45" -> "1,200"). This keeps
		// exactly 2 decimal places - for Principal/Interest Amount figures
		// where the decimal portion matters - while still adding thousands
		// separators for readability.
		_fmtAmount: function(vValue) {
			if (vValue === null || vValue === undefined || vValue === "") {
				return "";
			}
			var fValue = parseFloat(String(vValue).replace(/,/g, ""));
			if (isNaN(fValue)) {
				return "";
			}
			return fValue.toLocaleString("en-IN", {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2
			});
		},

		_dateToIso: function(oDate) {

			if (!(oDate instanceof Date) || isNaN(oDate.getTime())) {
				return "";
			}

			var iMonth = oDate.getMonth() + 1;
			var iDay = oDate.getDate();

			return oDate.getFullYear() + "-" +
				(iMonth < 10 ? "0" : "") + iMonth + "-" +
				(iDay < 10 ? "0" : "") + iDay;
		}
	});
});
