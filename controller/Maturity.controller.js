sap.ui.define([
    "./BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/core/format/DateFormat",
    "sap/ui/core/BusyIndicator",
    "../service/FdDetailsService",
    "../util/ODataErrorHandler"
], function (BaseController, JSONModel, MessageToast, MessageBox, Filter, FilterOperator, DateFormat, BusyIndicator, FdDetailsService, ODataErrorHandler) {
    "use strict";

    return BaseController.extend("com.infocus.zfifixeddepositZFI_FIXED_DEPOSIT.controller.Maturity", {

        onInit: function () {
            BaseController.prototype.onInit.apply(this, arguments);

            // Set the component's OData model as a named model on the view
            // (kept available under "odata" in case other bindings need it).
            var oODataModel = this.getOwnerComponent().getModel();
            this.getView().setModel(oODataModel, "odata");

            var oModel = new JSONModel({
                fdNumber: "",
                coCode: "",
                bankName: "",
                principal: 0,
                interestRate: 0,
                startDate: "",
                tenor: "",
                interest: 0,
                interestText: "0.000",
                calculatedInterestText: "0.000",
                isPremature: false,
                tdsAmount: 0,
                tdsGl: "",
                tdsDocNo: "",
                tdsApplicable: false,

                // Populated once maturity posting is confirmed (either via
                // the direct FD_MaturitySet response, or, when that call
                // 500s after already posting, via the MaturityDataDisplaySet
                // fallback check in _verifyMaturityCompletion).
                fdDocNo: "",
                maturityStatusText: "",

                // Extra fields for passing to backend
                compoundFreq: "",
                openingFd: "",
                glPrincipal: "",
                bankGl: "",
                glReceivable: "",
                glIncome: "",
                profitCenter: "",
                createDate: ""
            });

            this.getView().setModel(oModel, "maturity");

            // Populated after a successful maturity/TDS posting by reading
            // back MaturityDataDisplaySet (MATURITYDATADISP_GET_ENTITYSET) -
            // a pure display SELECT with no posting side effects - so the
            // screen shows exactly what is now persisted for this FD,
            // rather than only the client-side echo of what was sent.
            this.getView().setModel(new JSONModel({
                busy: false,
                error: "",
                records: []
            }), "maturityDisplay");

            // The FD dropdown used to bind straight to "odata>/FdDetailsSet"
            // declaratively in the view. That is not how any other page in
            // this app loads FdDetailsSet (Dashboard/FixedDeposits both go
            // through FdDetailsService.readFdDetails explicitly), and it was
            // the one place returning an empty/404'ing dropdown. Loading it
            // the same explicit way as everywhere else, into its own JSON
            // model, removes that difference and lets real errors (status
            // code / message) be shown instead of a silently empty list.
            var oFdListModel = new JSONModel({
                items: [],
                busy: true,
                error: ""
            });
            oFdListModel.setSizeLimit(1000); // UI5 default is 100, we need more
            this.getView().setModel(oFdListModel, "fdList");

            this._loadFdList();
        },

        _loadFdList: function () {
            var oODataModel = this.getOwnerComponent().getModel();
            var oFdListModel = this.getView().getModel("fdList");
            var oMaturityModel = this.getView().getModel("maturity");

            if (!oODataModel || !oODataModel.read) {
                oFdListModel.setProperty("/busy", false);
                oFdListModel.setProperty("/error", "OData model is not available.");
                return;
            }

            var fnRead = function () {
                oFdListModel.setProperty("/busy", true);
                oFdListModel.setProperty("/error", "");

                // Fetch MaturityDataDisplaySet first to know which FDs have already been processed
                oODataModel.read("/MaturityDataDisplaySet", {
                    success: function (oMatResponse) {
                        var aMaturedRecords = (oMatResponse && oMatResponse.results) || [];
                        var oMaturedMap = {};
                        aMaturedRecords.forEach(function(oRec) {
                            if (oRec.FdAccno && oRec.CoCode) {
                                oMaturedMap[oRec.CoCode + "-" + oRec.FdAccno] = true;
                            }
                        });

                        FdDetailsService.readFdDetails(oODataModel, {
                            success: function (oResponse) {
                                var aResults = (oResponse && oResponse.results) || [];
                                var sCurrentFd = oMaturityModel ? oMaturityModel.getProperty("/fdNumber") : null;

                                // Filter out already processed/matured FDs
                                var aUnprocessed = aResults.filter(function(oRow) {
                                    if (sCurrentFd && oRow.FdAccno === sCurrentFd) {
                                        return true; // ALWAYS keep the currently selected FD visible so KPIs don't disappear
                                    }

                                    var status = (oRow.Status || oRow.StatusText || "").toLowerCase();
                                    if (status === "matured") return false;
                                    
                                    // Strictly filter out any FD that already has a successful maturity record
                                    if (oRow.FdAccno && oRow.CoCode && oMaturedMap[oRow.CoCode + "-" + oRow.FdAccno]) {
                                        return false;
                                    }
                                    return true;
                                });

                                oFdListModel.setProperty("/items", aUnprocessed);
                                oFdListModel.setProperty("/busy", false);
                                oFdListModel.setProperty(
                                    "/error",
                                    aUnprocessed.length ? "" : "No unprocessed fixed deposits found."
                                );
                            },
                            error: function (oError) {
                                oFdListModel.setProperty("/busy", false);

                                var iStatus = oError && oError.response && oError.response.statusCode;
                                var sDetail = ODataErrorHandler.extract(oError, "Could not load the FD list.");
                                var sMsg = (iStatus ? "[" + iStatus + "] " : "") + sDetail;

                                oFdListModel.setProperty("/error", sMsg);
                                MessageToast.show(sMsg);
                            }
                        });
                    },
                    error: function (oError) {
                        oFdListModel.setProperty("/busy", false);
                        var iStatus = oError && oError.response && oError.response.statusCode;
                        var sDetail = ODataErrorHandler.extract(oError, "Failed to check maturity history. Cannot safely load FD list.");
                        var sMsg = (iStatus ? "[" + iStatus + "] " : "") + sDetail;
                        oFdListModel.setProperty("/error", sMsg);
                        MessageToast.show(sMsg);
                    }
                });
            };

            // Guard against firing the read before service metadata is
            // available - harmless if metadataLoaded() isn't supported by
            // the model version, it just falls through to reading directly.
            if (oODataModel.getServiceMetadata && oODataModel.getServiceMetadata()) {
                fnRead();
            } else if (typeof oODataModel.metadataLoaded === "function") {
                oODataModel.metadataLoaded().then(fnRead, function () {
                    oFdListModel.setProperty("/busy", false);
                    oFdListModel.setProperty("/error", "Service metadata could not be loaded.");
                });
            } else {
                fnRead();
            }
        },

        onFDSelectionChange: function (oEvent) {
            var oSelectedItem = oEvent.getParameter("selectedItem") || oEvent.getParameter("listItem");
            if (!oSelectedItem && oEvent.getSource().getSelectedItem) {
                oSelectedItem = oEvent.getSource().getSelectedItem();
            }
            if (!oSelectedItem) return;

            // Dropdown/Table items are bound to the "fdList" model now, not "odata".
            var oContext = oSelectedItem.getBindingContext("fdList");
            var oData = oContext.getObject();
            var oModel = this.getView().getModel("maturity");

            var oDateFormat = DateFormat.getInstance({ pattern: "yyyy-MM-dd" });
            var sStartDate = oData.StartDate ? oDateFormat.format(oData.StartDate) : "";
            
            var oCreateDateObj = oData.CREATE_DATE ? new Date(oData.CREATE_DATE) : new Date();
            var sCreateDate = oDateFormat.format(oCreateDateObj);

            var oStartDateObj = oData.StartDate ? new Date(oData.StartDate) : new Date();
            oStartDateObj.setHours(0, 0, 0, 0);

            var fRenewalAmt = parseFloat(oData.RenewalAmt || oData.RENEWAL_AMT || oData.renewal_amt) || 0;
            var fPrincipal = fRenewalAmt > 0 ? fRenewalAmt : (parseFloat(oData.PrincipalAmt) || 0);
            var fLien = parseFloat(oData.LienAmt || oData.LIEN_AMT || oData.lien_amt) || 0;
            if (!fLien && oData.FdAccno) {
                try {
                    var sCached = window.localStorage.getItem("FD_LIEN_" + oData.FdAccno);
                    if (sCached) fLien = Number(sCached) || 0;
                } catch (e) {}
            }
            var fNotLien = parseFloat(oData.NotLienAmt || oData.NOT_LIEN_AMT || oData.not_lien_amt) || Math.max(0, fPrincipal - fLien);
            var fRate = parseFloat(oData.InterestRate) || 0;
            var iTenor = parseFloat(oData.TenorMonths) || 0;

            // Use Scheduled Maturity Date from backend if available, otherwise fallback to calculation
            var oScheduledMaturityDate;
            if (oData.MATURITY_DATE || oData.MaturityDate) {
                oScheduledMaturityDate = new Date(oData.MATURITY_DATE || oData.MaturityDate);
                oScheduledMaturityDate.setHours(0, 0, 0, 0);
            } else {
                oScheduledMaturityDate = new Date(oStartDateObj.getTime());
                var iMonths = Math.floor(iTenor);
                var iDays = Math.round((iTenor - iMonths) * 30);
                oScheduledMaturityDate.setMonth(oScheduledMaturityDate.getMonth() + iMonths);
                oScheduledMaturityDate.setDate(oScheduledMaturityDate.getDate() + iDays);
                oScheduledMaturityDate.setHours(0, 0, 0, 0);
            }

            var oToday = new Date();
            oToday.setHours(0, 0, 0, 0);

            var oEffectiveMaturityDate = new Date(oToday.getTime());
            if (oEffectiveMaturityDate > oScheduledMaturityDate) {
                oEffectiveMaturityDate = new Date(oScheduledMaturityDate.getTime());
            }

            var iDiffTime = oEffectiveMaturityDate.getTime() - oStartDateObj.getTime();
            var iInterestDays = Math.round(iDiffTime / (1000 * 3600 * 24));
            if (iInterestDays < 0) iInterestDays = 0;

            var sCalculatedTenorMonths = (iInterestDays / (365/12)).toFixed(1);

            // Debug logging as requested
            console.log("Start Date:", oStartDateObj);
            console.log("Scheduled Maturity:", oScheduledMaturityDate);
            console.log("Effective Maturity:", oEffectiveMaturityDate);
            console.log("Difference (ms):", iDiffTime);
            console.log("Interest Days:", iInterestDays);

            // Calculate Interest Amount upfront based on effective days
            var fInterest = (fPrincipal * fRate * iInterestDays) / 36500;
            var fTdsEst = fInterest > 5000 ? fInterest * 0.1 : 0;
            var fNetInterest = fInterest - fTdsEst;

            var sEffectiveMaturityDateText = oDateFormat.format(oEffectiveMaturityDate);
            var sScheduledMaturityDateText = oDateFormat.format(oScheduledMaturityDate);
            var sSystemDateText = oDateFormat.format(oToday);

            var bIsPremature = (oToday < oScheduledMaturityDate);

            oModel.setData({
                fdNumber: oData.FdAccno,
                coCode: oData.CoCode,
                bankName: oData.BankName,
                principal: fPrincipal,
                lienAmt: fLien,
                notLienAmt: fNotLien,
                lienAmtText: this._fmtAmount(fLien),
                notLienAmtText: this._fmtAmount(fNotLien),
                interestRate: fRate,
                startDate: sStartDate,
                tenor: oData.TenorMonths,
                calculatedTenorMonths: sCalculatedTenorMonths,
                interestDays: iInterestDays, // Added to survive setData
                interest: fInterest,
                interestText: fInterest.toFixed(3),
                calculatedInterestText: fInterest.toFixed(3),
                netInterestText: fNetInterest.toFixed(3),
                estimatedTdsText: fTdsEst.toFixed(3),
                isPremature: bIsPremature,

                tdsAmount: 0,
                tdsGl: "",
                tdsDocNo: "",
                tdsApplicable: false,
                fdDocNo: "",
                maturityStatusText: "",

                compoundFreq: oData.CompoundFreq,
                openingFd: oData.OPENING_FD,
                glPrincipal: oData.GlPrincipal,
                bankGl: oData.BankGl,
                glReceivable: oData.GlReceivable,
                glIncome: oData.GlIncome,
                profitCenter: oData.ProfitCenter,
                createDate: sCreateDate,
                
                actualMaturityDateText: sEffectiveMaturityDateText,
                scheduledMaturityDateText: sScheduledMaturityDateText,
                systemDateText: sSystemDateText
            });

            // Calculate maturity date for the timeline
            var aTimeline = [
                {
                    icon: "sap-icon://document",
                    colorHex: "#3B82F6",
                    title: "Fixed Deposit Created",
                    subtitle: "Principal Amount: " + oModel.getProperty("/principal") + " INR\nBank: " + oModel.getProperty("/bankName"),
                    dateText: sStartDate
                },
                {
                    icon: "sap-icon://calculator",
                    colorHex: "#10B981",
                    title: "Interest Accumulation",
                    subtitle: "Total expected interest: " + fInterest.toFixed(3) + " INR\nRate: " + fRate + "%",
                    dateText: "Calculated till " + sEffectiveMaturityDateText + " (" + iInterestDays + " days)"
                },
                {
                    icon: "sap-icon://flag",
                    colorHex: "#F97316",
                    title: "Maturity Scheduled",
                    subtitle: (oToday < oScheduledMaturityDate) ? "Premature Maturity" : "Awaiting processing",
                    dateText: sScheduledMaturityDateText
                }
            ];
            oModel.setProperty("/timeline", aTimeline);

            var oDisplayModel = this.getView().getModel("maturityDisplay");
            oDisplayModel.setProperty("/records", []);
            oDisplayModel.setProperty("/error", "");

            // Just display the FD's own details here - do NOT call the
            // maturity backend yet. Per the ABAP logic, FD_MATURITYSET_GET_ENTITYSET
            // only ever runs the SUBMIT/posting logic when TDS_IND = 'X',
            // so firing it on plain selection (TDS_IND = '') never returned
            // anything useful anyway - it just wasted a round trip. The
            // maturity/TDS run is now only triggered from onTDSSelect,
            // when the "TDS Applicable" checkbox is actually selected.
        },

        onNavMaturityHistory: function() {
            this.getOwnerComponent().getRouter().navTo("maturityHistory");
        },

        onNavMaturityCalendar: function() {
            this.getOwnerComponent().getRouter().navTo("maturityCalendar");
        },

        onRefreshFDList: function() {
            // Clear current selection to prevent stale data
            var oMaturityModel = this.getView().getModel("maturity");
            if (oMaturityModel) {
                oMaturityModel.setProperty("/fdNumber", "");
            }
            this._loadFdList();
            sap.m.MessageToast.show("FD List refreshed");
        },

        onTDSSelect: function (oEvent) {
            var bSelected = oEvent.getParameter("selected");
            var oModel = this.getView().getModel("maturity");
            
            if (bSelected) {
                if (!oModel.getProperty("/fdNumber")) {
                    MessageBox.error("Please select a Fixed Deposit from the list before processing Maturity.");
                    oEvent.getSource().setSelected(false);
                    return;
                }
                // User checks TDS -> validate interest and proceed with maturity processing (TDS_IND='X')
                this._validateAndProceedWithMaturity(true, function () {
                    oEvent.getSource().setSelected(false);
                    oModel.setProperty("/tdsApplicable", false);
                });
            } else {
                // Unchecked -> normal display only, clear TDS-specific fields
                oModel.setProperty("/tdsAmount", 0);
                oModel.setProperty("/tdsGl", "");
                oModel.setProperty("/tdsDocNo", "");
            }
        },

        onMaturityDateChange: function (oEvent) {
            var oModel = this.getView().getModel("maturity");
            var sNewDate = oEvent.getParameter("value"); // yyyy-MM-dd
            if (!sNewDate) {
                return;
            }

            var oNewMaturityDate = new Date(sNewDate + "T00:00:00");
            if (isNaN(oNewMaturityDate.getTime())) {
                return;
            }

            var sStartDate = oModel.getProperty("/startDate");
            var sScheduledDate = oModel.getProperty("/scheduledMaturityDateText");
            var oStartDateObj = sStartDate ? new Date(sStartDate + "T00:00:00") : null;
            var oScheduledDateObj = sScheduledDate ? new Date(sScheduledDate + "T00:00:00") : null;

            if (oStartDateObj && oNewMaturityDate < oStartDateObj) {
                MessageToast.show("Maturity date cannot be earlier than start date (" + sStartDate + ").");
                oModel.setProperty("/actualMaturityDateText", sStartDate);
                oNewMaturityDate = oStartDateObj;
                sNewDate = sStartDate;
            }

            if (oScheduledDateObj && oNewMaturityDate > oScheduledDateObj) {
                MessageToast.show("Premature maturity date cannot be later than scheduled maturity date (" + sScheduledDate + ").");
                oModel.setProperty("/actualMaturityDateText", sScheduledDate);
                oNewMaturityDate = oScheduledDateObj;
                sNewDate = sScheduledDate;
            }

            var iDiffTime = oStartDateObj ? (oNewMaturityDate.getTime() - oStartDateObj.getTime()) : 0;
            var iInterestDays = Math.round(iDiffTime / (1000 * 3600 * 24));
            if (iInterestDays < 0) iInterestDays = 0;

            var sCalculatedTenorMonths = (iInterestDays / (365 / 12)).toFixed(1);
            var fPrincipal = parseFloat(oModel.getProperty("/principal")) || 0;
            var fRate = parseFloat(oModel.getProperty("/interestRate")) || 0;

            var fInterest = (fPrincipal * fRate * iInterestDays) / 36500;
            var fTdsEst = fInterest > 5000 ? (fInterest * 0.1) : 0;
            var fNetInterest = fInterest - fTdsEst;

            oModel.setProperty("/actualMaturityDateText", sNewDate);
            oModel.setProperty("/interestDays", iInterestDays);
            oModel.setProperty("/calculatedTenorMonths", sCalculatedTenorMonths);
            oModel.setProperty("/calculatedInterestText", fInterest.toFixed(3));
            oModel.setProperty("/interest", fInterest);
            oModel.setProperty("/interestText", fInterest.toFixed(3));
            oModel.setProperty("/estimatedTdsText", fTdsEst.toFixed(3));
            oModel.setProperty("/netInterestText", fNetInterest.toFixed(3));

            // Update timeline
            var aTimeline = oModel.getProperty("/timeline");
            if (aTimeline && aTimeline.length >= 3) {
                aTimeline[1].subtitle = "Total expected interest: " + fInterest.toFixed(3) + " INR\nRate: " + fRate + "%";
                aTimeline[1].dateText = "Calculated till " + sNewDate + " (" + iInterestDays + " days)";
                oModel.setProperty("/timeline", aTimeline);
            }
        },

        onInterestChange: function (oEvent) {
            var oModel = this.getView().getModel("maturity");
            var vVal = oEvent.getParameter("value");
            if (vVal === undefined || vVal === null) {
                vVal = oEvent.getSource().getValue();
            }
            var fInterest = parseFloat(vVal);
            if (isNaN(fInterest) || fInterest < 0) {
                fInterest = 0;
            }

            oModel.setProperty("/interest", fInterest);
            oModel.setProperty("/interestText", vVal);

            var fTdsEst = fInterest > 5000 ? (fInterest * 0.1) : 0;
            oModel.setProperty("/estimatedTdsText", fTdsEst.toFixed(3));
            oModel.setProperty("/netInterestText", (fInterest - fTdsEst).toFixed(3));

            var aTimeline = oModel.getProperty("/timeline");
            var fRate = parseFloat(oModel.getProperty("/interestRate")) || 0;
            if (aTimeline && aTimeline.length >= 3) {
                var sDisp = isNaN(parseFloat(vVal)) ? "0.000" : parseFloat(vVal).toFixed(3);
                aTimeline[1].subtitle = "Total expected interest: " + sDisp + " INR\nRate: " + fRate + "%";
                oModel.setProperty("/timeline", aTimeline);
            }
        },

        onRecalculateInterest: function () {
            var oModel = this.getView().getModel("maturity");
            var sActualDate = oModel.getProperty("/actualMaturityDateText");
            var sStartDate = oModel.getProperty("/startDate");
            var oStartDateObj = sStartDate ? new Date(sStartDate + "T00:00:00") : null;
            var oMatDateObj = sActualDate ? new Date(sActualDate + "T00:00:00") : new Date();

            var iDiffTime = (oStartDateObj && oMatDateObj) ? (oMatDateObj.getTime() - oStartDateObj.getTime()) : 0;
            var iInterestDays = Math.round(iDiffTime / (1000 * 3600 * 24));
            if (iInterestDays < 0) iInterestDays = 0;

            var fPrincipal = parseFloat(oModel.getProperty("/principal")) || 0;
            var fRate = parseFloat(oModel.getProperty("/interestRate")) || 0;
            var fInterest = (fPrincipal * fRate * iInterestDays) / 36500;
            var fTdsEst = fInterest > 5000 ? (fInterest * 0.1) : 0;
            var fNetInterest = fInterest - fTdsEst;

            oModel.setProperty("/interestDays", iInterestDays);
            oModel.setProperty("/calculatedInterestText", fInterest.toFixed(3));
            oModel.setProperty("/interest", fInterest);
            oModel.setProperty("/interestText", fInterest.toFixed(3));
            oModel.setProperty("/estimatedTdsText", fTdsEst.toFixed(3));
            oModel.setProperty("/netInterestText", fNetInterest.toFixed(3));

            var aTimeline = oModel.getProperty("/timeline");
            if (aTimeline && aTimeline.length >= 3) {
                aTimeline[1].subtitle = "Total expected interest: " + fInterest.toFixed(3) + " INR\nRate: " + fRate + "%";
                oModel.setProperty("/timeline", aTimeline);
            }
            MessageToast.show("Interest recalculated: ₹" + fInterest.toFixed(3));
        },

        onProcessMaturity: function () {
            var oModel = this.getView().getModel("maturity");
            if (!oModel.getProperty("/fdNumber")) {
                MessageBox.error("Please select a Fixed Deposit from the list before processing Maturity.");
                return;
            }
            this._validateAndProceedWithMaturity(true);
        },

        _validateAndProceedWithMaturity: function (bTdsChecked, fnOnCancel) {
            var oModel = this.getView().getModel("maturity");
            if (!oModel.getProperty("/fdNumber")) {
                MessageBox.error("Please select a Fixed Deposit from the list before processing Maturity.");
                if (typeof fnOnCancel === "function") {
                    fnOnCancel();
                }
                return;
            }

            var fEnteredInterest = parseFloat(oModel.getProperty("/interest")) || 0;
            var fCalculatedInterest = parseFloat(oModel.getProperty("/calculatedInterestText")) || 0;
            var bDiffers = Math.abs(fEnteredInterest - fCalculatedInterest) > 0.01;

            if (bDiffers) {
                MessageBox.warning(
                    "The entered interest differs from the system-calculated interest. SAP will recalculate the amount during posting. Please verify the amount before proceeding.",
                    {
                        title: "Interest Verification",
                        actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                        emphasizedAction: MessageBox.Action.OK,
                        onClose: function (sAction) {
                            if (sAction === MessageBox.Action.OK) {
                                this._fetchMaturityDetails(bTdsChecked);
                            } else if (typeof fnOnCancel === "function") {
                                fnOnCancel();
                            }
                        }.bind(this)
                    }
                );
            } else {
                this._fetchMaturityDetails(bTdsChecked);
            }
        },

        _fetchMaturityDetails: function (bTdsChecked) {
            var oModel = this.getView().getModel("maturity");
            var oData = oModel.getData();
            var oODataModel = this.getOwnerComponent().getModel();

            if (!oData.fdNumber) {
                return;
            }

            var sTdsInd = bTdsChecked ? "X" : "";

            // These property names must match the EDM property names
            // exactly as declared in the live $metadata for the FD_Maturity
            // entity type (ZFI_FIXED_DEPOSIT_SRV), not ABAP structure field
            // names. Most properties are CamelCase; only CREATE_DATE,
            // TDS_IND, TDS_AMT, TDS_GL, TDS_DOC_NO, FD_REV_NO and INT_AMT are
            // declared with underscores.
            var aFilters = [
                new Filter("CoCode", FilterOperator.EQ, oData.coCode || ""),
                new Filter("FdAccno", FilterOperator.EQ, oData.fdNumber || ""),
                new Filter("BankName", FilterOperator.EQ, oData.bankName || ""),
                new Filter("PrincipalAmt", FilterOperator.EQ, parseFloat(oData.principal).toFixed(2)),
                new Filter("InterestRate", FilterOperator.EQ, parseFloat(oData.interestRate).toFixed(2)),
                new Filter("StartDate", FilterOperator.EQ, oData.startDate ? this._toODataDateTime(oData.startDate) : ""),
                new Filter("TenorMonths", FilterOperator.EQ, oData.tenor || ""),
                new Filter("CompoundFreq", FilterOperator.EQ, oData.compoundFreq || ""),
                new Filter("OpeningFd", FilterOperator.EQ, oData.openingFd || ""),
                new Filter("GlPrincipal", FilterOperator.EQ, this.padTo10(oData.glPrincipal)),
                new Filter("BankGl", FilterOperator.EQ, this.padTo10(oData.bankGl)),
                new Filter("GlReceivable", FilterOperator.EQ, this.padTo10(oData.glReceivable)),
                new Filter("GlIncome", FilterOperator.EQ, this.padTo10(oData.glIncome)),
                new Filter("ProfitCenter", FilterOperator.EQ, this.padTo10(oData.profitCenter)),
                new Filter("CREATE_DATE", FilterOperator.EQ, oData.createDate ? this._toODataDateTime(oData.createDate) : ""),
                new Filter(
                    "MATURITY_DATE",
                    FilterOperator.EQ,
                    oData.actualMaturityDateText ? this._toODataDateTime(oData.actualMaturityDateText) : ""
                ),
                new Filter("TDS_IND", FilterOperator.EQ, sTdsInd),
                new Filter("INT_AMT", FilterOperator.EQ, Number(parseFloat(oData.interest).toFixed(2))),
                new Filter("TDS_GL", FilterOperator.EQ, "0000220300") // Pass default padded GL
            ];

            BusyIndicator.show(0);

            // Entity set is "FD_MaturitySet" (matches metadata exactly,
            // including case - OData paths are case-sensitive).
            oODataModel.read("/FD_MaturitySet", {
                filters: aFilters,
                success: function (oResponse) {
                    BusyIndicator.hide();

                    if (oResponse && oResponse.results && oResponse.results.length > 0) {
                        var oResult = oResponse.results[0];

                        // Payload property names match the metadata exactly
                        // (INT_AMT / TDS_AMT / TDS_GL / TDS_DOC_NO).
                        if (oResult.INT_AMT) {
                            oModel.setProperty("/interest", parseFloat(oResult.INT_AMT));
                            oModel.setProperty("/interestText", parseFloat(oResult.INT_AMT).toFixed(3));
                        }

                        if (bTdsChecked) {
                            oModel.setProperty("/fdDocNo", oResult.FdDocNo || oResult.FD_DOC_NO || "");

                            if (parseFloat(oResult.TDS_AMT) > 0) {
                                // Interest > 5000 case
                                oModel.setProperty("/tdsAmount", parseFloat(oResult.TDS_AMT));
                                oModel.setProperty("/tdsGl", oResult.TDS_GL);
                                oModel.setProperty("/tdsDocNo", oResult.TDS_DOC_NO);
                                oModel.setProperty("/maturityStatusText", "Maturity is complete.");
                                oModel.setProperty("/timeline/2/title", "Maturity Processed");
                                oModel.setProperty("/timeline/2/colorClass", "fdPurpleIcon");
                                oModel.setProperty("/timeline/2/subtitle", "TDS deducted: " + oResult.TDS_AMT);
                                MessageToast.show("TDS and Maturity processed successfully.");
                                this._loadMaturityDisplayData(oData.coCode, oData.fdNumber);
                            } else {
                                // Interest <= 5000 case (backend returns blanks for TDS amount/GL but may still return maturity doc)
                                oModel.setProperty("/tdsAmount", 0);
                                oModel.setProperty("/tdsGl", "");
                                oModel.setProperty("/tdsDocNo", oResult.TDS_DOC_NO || "");
                                oModel.setProperty("/maturityStatusText", "Maturity is complete.");
                                oModel.setProperty("/timeline/2/title", "Maturity Processed");
                                oModel.setProperty("/timeline/2/colorClass", "fdPurpleIcon");
                                oModel.setProperty("/timeline/2/subtitle", "No TDS deducted");
                                MessageToast.show("Interest ≤ 5000. Maturity processed without TDS.");
                                this._loadMaturityDisplayData(oData.coCode, oData.fdNumber);
                            }
                        }
                    } else {
                        // In case backend returns empty (e.g. if TDS_IND='' returns nothing in current ABAP logic)
                        if (bTdsChecked) {
                            MessageToast.show("Maturity was not processed. Please check the FD details.");
                        }
                    }
                }.bind(this),
                error: function (oError) {
                    BusyIndicator.hide();

                    // FD_MaturitySet's read also runs the actual posting
                    // logic (FD doc + GL entries) as a side effect. The
                    // backend can commit that successfully and *then* blow
                    // up on a date conversion, which comes back to us as a
                    // plain 500 - even though the maturity run itself did
                    // not fail. Rather than surface that raw error to the
                    // user, check the read-only MaturityDataDisplaySet
                    // (no posting side effects, so it can't itself 500 the
                    // same way) to see whether the record was actually
                    // created before deciding what to tell the user.
                    if (bTdsChecked) {
                        this._verifyMaturityCompletion(oData.coCode, oData.fdNumber, oModel, oError);
                        return;
                    }

                    var iStatus = oError && oError.response && oError.response.statusCode;
                    var sDetail = ODataErrorHandler.extract(oError, "Failed to fetch maturity details.");
                    
                    if (sDetail && sDetail.toLowerCase().indexOf("property and not found int type_fd") !== -1) {
                        sDetail = "Maturity not applicable for this FD";
                    }
                    
                    var sMsg = (iStatus ? "[" + iStatus + "] " : "") + sDetail;

                    MessageToast.show(sMsg);
                    // eslint-disable-next-line no-console
                    console.error("FD_MaturitySet read failed:", oError);
                }.bind(this)
            });
        },

        // Reads back MaturityDataDisplaySet (MATURITYDATADISP_GET_ENTITYSET)
        // for the FD just processed, and shows it in the "Posted Maturity
        // Data" section on the page. This is a pure display SELECT with no
        // posting side effects, so it is safe to call every time a
        // maturity/TDS run completes - it never re-triggers posting.
        _loadMaturityDisplayData: function (sCoCode, sFdAccno) {
            var oODataModel = this.getOwnerComponent().getModel();
            var oDisplayModel = this.getView().getModel("maturityDisplay");

            if (!oODataModel || !oODataModel.read || !sCoCode || !sFdAccno) {
                return;
            }

            oDisplayModel.setProperty("/busy", true);
            oDisplayModel.setProperty("/error", "");

            var aFilters = [
                new Filter("CoCode", FilterOperator.EQ, sCoCode),
                new Filter("FdAccno", FilterOperator.EQ, sFdAccno)
            ];

            oODataModel.read("/MaturityDataDisplaySet", {
                filters: aFilters,
                success: function (oResponse) {
                    var aResults = (oResponse && oResponse.results) || [];
                    oDisplayModel.setProperty("/busy", false);
                    oDisplayModel.setProperty(
                        "/records",
                        aResults.map(this._mapMaturityDisplayRecord.bind(this))
                    );
                    oDisplayModel.setProperty(
                        "/error",
                        aResults.length ? "" : "No posted maturity data was returned for this FD."
                    );
                    
                    // Refresh the FD Dropdown so the processed FD disappears from the list
                    this._loadFdList();
                }.bind(this),
                error: function (oError) {
                    oDisplayModel.setProperty("/busy", false);
                    oDisplayModel.setProperty(
                        "/error",
                        ODataErrorHandler.extract(oError, "Could not load posted maturity data.")
                    );
                    // eslint-disable-next-line no-console
                    console.error("MaturityDataDisplaySet load failed:", oError);
                }
            });
        },

        // Converts a raw MaturityDataDisplaySet entity into the flat,
        // display-ready shape the view's table binds to.
        _mapMaturityDisplayRecord: function (oEntity) {
            var oDateFormat = DateFormat.getInstance({ pattern: "dd MMM yyyy" });
            var fnFormatDate = function (vDate) {
                return vDate ? oDateFormat.format(new Date(vDate)) : "";
            };

            var fTdsAmt = parseFloat(oEntity.TDS_AMT) || 0;
            var fRenewalAmt = parseFloat(oEntity.RenewalAmt || oEntity.RENEWAL_AMT || oEntity.renewal_amt) || 0;
            var fPrincipal = fRenewalAmt > 0 ? fRenewalAmt : (parseFloat(oEntity.PrincipalAmt) || 0);

            return {
                coCode: oEntity.CoCode || "",
                fdAccno: oEntity.FdAccno || "",
                bankName: oEntity.BankName || "",
                principalAmt: fPrincipal,
                interestRate: parseFloat(oEntity.InterestRate) || 0,
                startDate: fnFormatDate(oEntity.StartDate),
                tenorMonths: oEntity.TenorMonths || "",
                compoundFreq: oEntity.CompoundFreq || "",
                profitCenter: oEntity.ProfitCenter || "",
                fdDocNo: oEntity.FdDocNo || oEntity.FD_DOC_NO || "",
                createDate: fnFormatDate(oEntity.CREATE_DATE),
                tdsAmt: fTdsAmt,
                tdsGl: oEntity.TDS_GL || "",
                tdsDocNo: oEntity.TDS_DOC_NO || "",
                tdsApplicable: fTdsAmt > 0 ? "Yes" : "No",
                tdsState: fTdsAmt > 0 ? "Warning" : "Success"
            };
        },

        // Confirms whether the maturity/TDS posting actually went through
        // on the backend, despite FD_MaturitySet having returned an error.
        // MaturityDataDisplaySet is a pure display SELECT (see
        // MATURITYDATADISP_GET_ENTITYSET) with no posting side effects, so
        // it's safe to use purely as a "did this really fail?" check.
        _verifyMaturityCompletion: function (sCoCode, sFdAccno, oModel, oOriginalError) {
            var oODataModel = this.getOwnerComponent().getModel();

            var aFilters = [
                new Filter("CoCode", FilterOperator.EQ, sCoCode || ""),
                new Filter("FdAccno", FilterOperator.EQ, sFdAccno || "")
            ];

            oODataModel.read("/MaturityDataDisplaySet", {
                filters: aFilters,
                success: function (oResponse) {
                    var aResults = (oResponse && oResponse.results) || [];
                    var oRecord = aResults[0];

                    // number for this FD - that only gets written once the
                    // FD doc / GL posting has actually happened.
                    var bPosted = oRecord && (oRecord.TDS_DOC_NO);

                    if (bPosted) {
                        oModel.setProperty("/fdDocNo", oRecord.FdDocNo || oRecord.FD_DOC_NO || "");
                        oModel.setProperty("/tdsAmount", parseFloat(oRecord.TDS_AMT) || 0);
                        oModel.setProperty("/tdsGl", oRecord.TDS_GL || "");
                        oModel.setProperty("/tdsDocNo", oRecord.TDS_DOC_NO || "");
                        oModel.setProperty("/maturityStatusText", "Maturity is complete.");
                        
                        var fTdsAmount = parseFloat(oRecord.TDS_AMT) || 0;
                        oModel.setProperty("/timeline/2/title", "Maturity Processed");
                        oModel.setProperty("/timeline/2/colorClass", "fdPurpleIcon");
                        oModel.setProperty("/timeline/2/subtitle", fTdsAmount > 0 ? "TDS deducted: " + fTdsAmount : "No TDS deducted");
                        
                        MessageToast.show("Maturity is complete.");
                        this._loadMaturityDisplayData(sCoCode, sFdAccno);
                    } else {
                        // Genuinely not posted - now it's fair to show the
                        // real error instead of a false "success".
                        this._showMaturityError(oOriginalError, oModel);
                    }
                }.bind(this),
                error: function () {
                    // Couldn't even verify - fall back to the original
                    // error rather than claim success we can't confirm.
                    this._showMaturityError(oOriginalError, oModel);
                }.bind(this)
            });
        },

        _showMaturityError: function (oError, oModel) {
            // As requested by user, replace any generic OData error with this standard message
            var sMsg = "Maturity performed.Status: Failed.Refer to table for details";

            MessageToast.show(sMsg);
            // eslint-disable-next-line no-console
            console.error("FD_MaturitySet read failed:", oError);

            oModel.setProperty("/tdsApplicable", false);
        }
    });
});