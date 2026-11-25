sap.ui.define([
	"./BaseController",
	"sap/m/MessageBox",
	"sap/ui/model/Filter",
	"sap/ui/model/FilterOperator",
	"sap/m/BusyDialog",
	"sap/ui/model/json/JSONModel",
	"sap/m/Dialog",
	"sap/m/DatePicker",
	"sap/m/VBox",
	"sap/m/Text",
	"sap/m/Button",
	"sap/m/Table",
	"sap/m/Column",
	"sap/m/ColumnListItem",
	"sap/m/ObjectStatus",
	"../service/FdDetailsService"
], function(BaseController, MessageBox, Filter, FilterOperator, BusyDialog, JSONModel, Dialog, DatePicker, VBox, Text, Button, Table, Column, ColumnListItem, ObjectStatus, FdDetailsService) {
	"use strict";

	return BaseController.extend("com.infocus.zfifixeddepositZFI_FIXED_DEPOSIT.controller.FixedDeposits", {
		onInit: function() {
			BaseController.prototype.onInit.apply(this, arguments);

			this.getView().addEventDelegate({
				onAfterRendering: function() {
					var oDomRef = this.getView().getDomRef();
					if (!oDomRef) return;
					
					var handleDragOver = function(e) {
						e.preventDefault();
						e.stopPropagation();
						e.dataTransfer.dropEffect = 'copy';
					};
					
					var handleDrop = function(e) {
						e.preventDefault();
						e.stopPropagation();
						
						if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
							var oFile = e.dataTransfer.files[0];
							var sName = oFile.name.toLowerCase();
							
							if (sName.endsWith(".csv")) {
								this._parseUploadedCSVFile(oFile);
							} else if (sName.endsWith(".xlsx")) {
								this._parseUploadedExcelFile(oFile);
							} else {
								MessageBox.error("Only CSV and XLSX files are supported for Mass Upload.");
							}
						}
					}.bind(this);
					
					oDomRef.addEventListener('dragover', handleDragOver);
					oDomRef.addEventListener('drop', handleDrop);
				}.bind(this)
			});
		},

		onDownloadTemplate: function () {
			console.time("TEMPLATE DOWNLOAD");
			console.log("1. Handler started");

			// Matches ZFI_FD_MASS_UPLOAD_RPT column structure (1 to 15)
			var sCsv =
				"Company Code,Bank,FD Number,Purpose,Principal Amount,Annual Rate,Start Date,Maturity Date,Compounding,Principal GL(FD GL),Bank GL,Interest Rec GL,Interest Inc GL,Profit Center,Lien Amount\n" +
				"1100,ICICI Bank,00001,INVESTMENT,100000,7.5,2024-01-01,2025-01-01,Monthly,270051,150170,280100,310060,11101401,30000";

			console.log("2. CSV created");

			var oBlob = new Blob([sCsv], {
				type: "text/csv;charset=utf-8;"
			});

			console.log("3. Blob created");

			var sUrl = URL.createObjectURL(oBlob);

			var oLink = document.createElement("a");
			oLink.href = sUrl;
			oLink.download = "FD_Mass_Upload_Template.csv";

			document.body.appendChild(oLink);

			console.log("4. About to click");

			oLink.click();

			console.log("5. Click completed");

			document.body.removeChild(oLink);

			URL.revokeObjectURL(sUrl);

			console.timeEnd("TEMPLATE DOWNLOAD");
		},

		onMassUpload: function () {
			var oCrossAppNav = sap.ushell && sap.ushell.Container && sap.ushell.Container.getService("CrossApplicationNavigation");
			if (oCrossAppNav && !window.location.href.includes("workspace") && !window.location.href.includes("localhost")) {
				oCrossAppNav.toExternal({
					target: {
						semanticObject: "ZFI_FD_UPLOAD",
						action: "display"
					}
				});
				return;
			}

			// In-app direct file upload picker for Web IDE / standalone runner
			if (!this._oFileInput) {
				this._oFileInput = document.createElement("input");
				this._oFileInput.type = "file";
				this._oFileInput.accept = ".csv, .xlsx";
				this._oFileInput.style.display = "none";
				this._oFileInput.addEventListener("change", function(e) {
					var oFile = e.target.files && e.target.files[0];
					if (!oFile) return;
					var sName = oFile.name.toLowerCase();
					if (sName.endsWith(".csv")) {
						this._parseUploadedCSVFile(oFile);
					} else if (sName.endsWith(".xlsx")) {
						this._loadXlsxAndParse(oFile);
					} else {
						MessageBox.error("Only CSV and XLSX files are supported.");
					}
					e.target.value = "";
				}.bind(this));
				document.body.appendChild(this._oFileInput);
			}
			this._oFileInput.click();
		},

		onUploadFD: function(oEvent) {
			var oFile = oEvent.getParameter("files")[0];
			if (!oFile) {
				return;
			}

			var sFileName = (oFile.name || "").toLowerCase();
			
			if (sFileName.endsWith(".csv")) {
				this._parseUploadedCSVFile(oFile);
			} else {
				this._loadXlsxAndParse(oFile);
			}
		},

		_loadXlsxAndParse: function(oFile) {
			var oBusy = new BusyDialog({ text: "Loading Excel processor..." });
			oBusy.open();

			var fnProcessFile = function() {
				oBusy.close();
				this._parseUploadedExcelFile(oFile);
			}.bind(this);

			if (typeof XLSX !== "undefined") {
				fnProcessFile();
				return;
			}

			var oScript = document.createElement("script");
			oScript.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
			oScript.onload = fnProcessFile;
			oScript.onerror = function() {
				oBusy.close();
				MessageBox.error("Unable to load the Excel processing library.");
			};
			document.head.appendChild(oScript);
		},

		_parseUploadedExcelFile: function(oFile) {
			var oBusy = new BusyDialog({ text: "Parsing Excel file..." });
			oBusy.open();

			var reader = new FileReader();
			reader.onload = function(e) {
				try {
					var data = new Uint8Array(e.target.result);
					var workbook = XLSX.read(data, { type: "array" });
					var firstSheetName = workbook.SheetNames[0];
					var worksheet = workbook.Sheets[firstSheetName];
					
					var json = XLSX.utils.sheet_to_json(worksheet, { raw: false });
					oBusy.close();

					if (json.length === 0) {
						MessageBox.error("The uploaded file contains no data.");
						return;
					}

					this._showPreviewDialog(json);
				} catch (err) {
					oBusy.close();
					MessageBox.error("Unable to read the uploaded Excel file.");
				}
			}.bind(this);
			
			reader.onerror = function() {
				oBusy.close();
				MessageBox.error("Error reading file.");
			};
			
			reader.readAsArrayBuffer(oFile);
		},

		_parseCSVLine: function(text) {
			var result = [];
			var curVal = "";
			var inQuotes = false;
			for (var i = 0; i < text.length; i++) {
				var char = text[i];
				if (inQuotes) {
					if (char === '"') {
						// Handle escaped quotes ""
						if (i + 1 < text.length && text[i+1] === '"') {
							curVal += '"';
							i++;
						} else {
							inQuotes = false;
						}
					} else {
						curVal += char;
					}
				} else {
					if (char === '"') {
						inQuotes = true;
					} else if (char === ',') {
						result.push(curVal);
						curVal = "";
					} else {
						curVal += char;
					}
				}
			}
			result.push(curVal);
			return result;
		},

		_parseUploadedCSVFile: function(oFile) {
			var oBusy = new BusyDialog({ text: "Parsing CSV file..." });
			oBusy.open();

			var reader = new FileReader();
			reader.onload = function(e) {
				try {
					var text = e.target.result;
					if (text.charCodeAt(0) === 0xFEFF) {
						text = text.substr(1);
					}
					var lines = text.split(/\r\n|\n/);
					if (lines.length < 2) {
						oBusy.close();
						MessageBox.error("The uploaded CSV file contains no data.");
						return;
					}
					
					var headers = this._parseCSVLine(lines[0]);
					var json = [];
					for (var i = 1; i < lines.length; i++) {
						var currentLine = lines[i];
						if (!currentLine.trim()) continue;
						
						var currentlineSplit = this._parseCSVLine(currentLine);
						var obj = {};
						
						for (var j = 0; j < headers.length; j++) {
							var header = (headers[j] || "").trim();
							var value = (currentlineSplit[j] || "").trim();
							if (header) {
								obj[header] = value;
							}
						}
						json.push(obj);
					}

					oBusy.close();
					if (json.length === 0) {
						MessageBox.error("The uploaded file contains no data.");
						return;
					}

					this._showPreviewDialog(json);
				} catch (err) {
					oBusy.close();
					MessageBox.error("Unable to parse CSV file.");
				}
			}.bind(this);
			
			reader.onerror = function() {
				oBusy.close();
				MessageBox.error("Error reading file.");
			};
			
			reader.readAsText(oFile);
		},

		_getRowVal: function(row, aAliases, sDefault) {
			if (!row) return sDefault !== undefined ? sDefault : "";
			var aKeys = Object.keys(row);
			for (var i = 0; i < aKeys.length; i++) {
				var sKey = aKeys[i];
				var sCleanKey = sKey.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
				for (var j = 0; j < aAliases.length; j++) {
					var sCleanAlias = aAliases[j].trim().toLowerCase().replace(/[^a-z0-9]/g, "");
					if (sCleanKey === sCleanAlias) {
						var v = row[sKey];
						return (v !== undefined && v !== null) ? String(v).trim() : (sDefault !== undefined ? sDefault : "");
					}
				}
			}
			return sDefault !== undefined ? sDefault : "";
		},

		_showPreviewDialog: function(aRows) {
			if (!aRows || aRows.length === 0) return;
			
			var bHasErrors = false;
			aRows.forEach(function(row) {
				var sCoCode = this._getRowVal(row, ["Company Code", "CoCode", "BUKRS"], "1100");
				var sId = this._getRowVal(row, ["FD Number", "ID", "FD_ACCNO", "FD Number/ID"], "");
				var sBank = this._getRowVal(row, ["Bank", "Bank Name", "BANK_NAME"], "");
				var sPrincipalStr = this._getRowVal(row, ["Principal Amount", "Principal", "PRINCIPAL_AMT", "PrincipalAmt"], "").replace(/[^\d.-]/g, "");
				var fPrincipal = parseFloat(sPrincipalStr);
				var sLienStr = this._getRowVal(row, ["Lien Amount", "Lien", "LIEN_AMT", "Lien Amt", "LienAmt"], "0").replace(/[^\d.-]/g, "");
				var fLien = parseFloat(sLienStr);
				if (isNaN(fLien) || fLien < 0) fLien = 0;
				var fNotLien = Math.max(0, (isNaN(fPrincipal) ? 0 : fPrincipal) - fLien);
				if (row["Not Lien Amount"] === undefined && row["Not Lien"] === undefined && row["NOT_LIEN_AMT"] === undefined) {
					row["Not Lien Amount"] = fNotLien;
				}
				var sRateStr = this._getRowVal(row, ["Annual Rate", "Rate", "INTEREST_RATE"], "").replace(/[^\d.-]/g, "");
				var fRate = parseFloat(sRateStr);

				var aErrors = [];
				if (!sCoCode) aErrors.push("Company Code missing");
				if (!sId) aErrors.push("FD Number missing");
				if (!sBank) aErrors.push("Bank missing");
				if (isNaN(fPrincipal) || fPrincipal <= 0) aErrors.push("Invalid Principal");
				if (isNaN(fLien) || fLien < 0) {
					aErrors.push("Lien Amount must be non-negative");
				} else if (fPrincipal > 0 && fLien > fPrincipal) {
					aErrors.push("Lien Amount cannot be greater than Principal Amount");
				}
				if (isNaN(fRate)) aErrors.push("Invalid Rate");

				// Check if FD already exists (matching ZFI_FD_MASS_UPLOAD_RPT)
				var aExistingFds = this.getModel() ? (this.getModel().getProperty("/fds") || []) : [];
				var bExists = aExistingFds.some(function(fd) {
					return String(fd.id) === String(sId) && String(fd.coCode || "1100") === String(sCoCode);
				});
				if (bExists) {
					aErrors.push("FD " + sId + " already exists");
				}

				// Date Validation
				var sStart = this._getRowVal(row, ["Start Date", "Start", "START_DATE"], "");
				var sMaturity = this._getRowVal(row, ["Maturity Date", "Maturity", "MATURITY_DATE"], "");
				
				var fnParseDate = function(vDate) {
					if (!vDate) return null;
					var sDate = String(vDate).trim();
					if (!sDate) return null;

					if (/^\d+(\.\d+)?$/.test(sDate)) {
						var excelDays = parseFloat(sDate);
						var jsDate = new Date((excelDays - 25569) * 86400 * 1000);
						jsDate = new Date(jsDate.getTime() + jsDate.getTimezoneOffset() * 60000);
						return jsDate;
					}

					var parts;
					if (sDate.indexOf("-") > 0) parts = sDate.split("-");
					else if (sDate.indexOf("/") > 0) parts = sDate.split("/");
					else if (sDate.indexOf(".") > 0) parts = sDate.split(".");

					if (parts && parts.length === 3) {
						if (parts[2].length === 4 || parts[2].length === 2) { 
							var y = Number(parts[2]);
							if (parts[2].length === 2) y += 2000;
							var p0 = Number(parts[0]);
							var p1 = Number(parts[1]);
							if (p0 > 12) {
								return new Date(y, p1 - 1, p0);
							} else if (p1 > 12) {
								return new Date(y, p0 - 1, p1);
							} else {
								return new Date(y, p1 - 1, p0);
							}
						} else if (parts[0].length === 4) { 
							var y = Number(parts[0]);
							var p1 = Number(parts[1]);
							var p2 = Number(parts[2]);
							if (p2 > 12) {
								return new Date(y, p1 - 1, p2);
							} else if (p1 > 12) {
								return new Date(y, p2 - 1, p1);
							} else {
								return new Date(y, p1 - 1, p2);
							}
						}
					}
					var d = new Date(sDate);
					return isNaN(d.getTime()) ? null : d;
				};

				var oStart = fnParseDate(sStart);
				var oMat = fnParseDate(sMaturity);

				if (!oStart) aErrors.push("Invalid Start Date");
				if (!oMat) aErrors.push("Invalid Maturity Date");
				
				if (oStart && oMat) {
					if (oMat <= oStart) {
						aErrors.push("Maturity must be after Start Date");
					}
				}

				if (aErrors.length > 0) {
					row._State = "Error";
					row._Status = aErrors.join(", ");
					bHasErrors = true;
				} else {
					row._State = "Success";
					row._Status = "Ready";
				}
			});

			var oModel = new JSONModel(aRows);
			var aKeys = Object.keys(aRows[0]).filter(function(k) { return k !== "_State" && k !== "_Status"; });
			
			var aColumns = [new Column({ width: "200px", header: new Text({ text: "Validation Status" }) })];
			var aCells = [new ObjectStatus({ 
				text: "{_Status}", 
				state: "{_State}",
				icon: "{= ${_State} === 'Error' ? 'sap-icon://error' : 'sap-icon://sys-enter-2' }"
			})];
			
			aKeys.forEach(function(sKey) {
				aColumns.push(new Column({ width: "150px", header: new Text({ text: sKey }) }));
				aCells.push(new Text({ text: "{" + sKey + "}" }));
			});

			var iTableWidth = 200 + (aKeys.length * 150);

			var oTable = new Table({
				width: iTableWidth + "px",
				columns: aColumns,
				alternateRowColors: true,
				sticky: ["ColumnHeaders"],
				fixedLayout: true,
				growing: true,
				growingThreshold: 100
			}).addStyleClass("fdDataTable sapUiTinyMarginTop");
			
			oTable.setModel(oModel);
			oTable.bindItems("/", new ColumnListItem({
				cells: aCells
			}));

			var oMessageStrip = new sap.m.MessageStrip({
				text: bHasErrors ? "Some entries contain errors. Please fix them in your spreadsheet and re-upload." : "All " + aRows.length + " entries have been validated and are ready for upload.",
				type: bHasErrors ? "Error" : "Success",
				showIcon: true
			}).addStyleClass("sapUiSmallMarginBottom");

			var oScrollContainer = new sap.m.ScrollContainer({
				horizontal: true,
				vertical: false,
				width: "100%",
				content: [oTable]
			});

			var oVBox = new VBox({
				items: [oMessageStrip, oScrollContainer]
			}).addStyleClass("sapUiSmallMargin");

			var oUploadBtn = new Button({
				text: "Upload Data",
				type: "Emphasized",
				enabled: !bHasErrors,
				icon: "sap-icon://upload",
				press: function() {
					oDialog.close();
					this._processMassUploadBatch(aRows);
				}.bind(this)
			});

			var oDialog = new Dialog({
				title: "Mass Upload Preview",
				icon: "sap-icon://table-view",
				contentWidth: "1200px",
				contentHeight: "600px",
				verticalScrolling: true,
				content: [oVBox],
				beginButton: oUploadBtn,
				endButton: new Button({
					text: "Cancel",
					press: function() {
						oDialog.close();
					}
				}),
				afterClose: function() {
					oDialog.destroy();
				}
			});

			this.getView().addDependent(oDialog);
			oDialog.open();
		},

		_processMassUploadBatch: function(aRows) {
			var oBusy = new BusyDialog({ text: "Uploading " + aRows.length + " FDs..." });
			oBusy.open();

			var oServiceModel = this.getOwnerComponent().getModel();
			if (!oServiceModel) {
				oBusy.close();
				MessageBox.error("OData Service is unavailable.");
				return;
			}

			var aResults = [];
			var i = 0;

			var fnProcessNext = function() {
				if (i >= aRows.length) {
					oBusy.close();
					this._showMassUploadSummary(aResults);

					var oModel = this.getOwnerComponent().getModel();
					oModel.refresh(true);
					this._loadFdDetailsFromService();

					return;
				}

				oBusy.setText("Uploading entry " + (i + 1) + " of " + aRows.length + "...");

				var row = aRows[i];
				i++;

				var sCoCode = this._getRowVal(row, ["Company Code", "CoCode", "BUKRS"], "1100");
				var sId = this._getRowVal(row, ["FD Number", "ID", "FD_ACCNO", "FD Number/ID"], "");
				var sBank = this._getRowVal(row, ["Bank", "Bank Name", "BANK_NAME"], "");
				
				var sPrincipalStr = this._getRowVal(row, ["Principal Amount", "Principal", "PRINCIPAL_AMT", "PrincipalAmt"], "").replace(/[^\d.-]/g, "");
				var fPrincipal = parseFloat(sPrincipalStr);
				if (isNaN(fPrincipal)) fPrincipal = 0;

				var sLienStr = this._getRowVal(row, ["Lien Amount", "Lien", "LIEN_AMT", "Lien Amt", "LienAmt"], "0").replace(/[^\d.-]/g, "");
				var fLien = parseFloat(sLienStr);
				if (isNaN(fLien) || fLien < 0) fLien = 0;
				var fNotLien = Math.max(0, fPrincipal - fLien);
				
				var sRateStr = this._getRowVal(row, ["Annual Rate", "Rate", "INTEREST_RATE"], "").replace(/[^\d.-]/g, "");
				var fRate = parseFloat(sRateStr);
				if (isNaN(fRate)) fRate = 0;
				
				var sOpeningFd = this._getRowVal(row, ["Purpose", "OpeningFd", "OPENING_FD"], "");
				var sStart = this._getRowVal(row, ["Start Date", "Start", "START_DATE"], "");
				var sMaturity = this._getRowVal(row, ["Maturity Date", "Maturity", "MATURITY_DATE"], "");
				
				var sFreqText = this._getRowVal(row, ["Compounding", "Freq", "COMPOUND_FREQ"], "");
				var sCompoundFreq = "Monthly";
				if (sFreqText.toLowerCase().indexOf("quarter") !== -1) sCompoundFreq = "Quarterly";
				else if (sFreqText.toLowerCase().indexOf("half") !== -1) sCompoundFreq = "Half-yearly";
				else if (sFreqText.toLowerCase().indexOf("year") !== -1) sCompoundFreq = "Yearly";
				
				var sGlP = this.padTo10(this._getRowVal(row, ["Principal GL", "Principal GL(FD GL)", "FD GL", "GlPrincipal", "GL_PRINCIPAL"]));
				var sBankGL = this.padTo10(this._getRowVal(row, ["Bank GL", "BankGl", "BANK_GL"]));
				var sGlI = this.padTo10(this._getRowVal(row, ["Interest Rec GL", "Interest Receivable GL", "GlReceivable", "GL_RECEIVABLE"]));
				var sGlInc = this.padTo10(this._getRowVal(row, ["Interest Inc GL", "Interest Income GL", "GlIncome", "GL_INCOME"]));
				var sProfitCenter = this.padTo10(this._getRowVal(row, ["Profit Center", "ProfitCenter", "PROFIT_CENTER"]));

				var fnParseDate = function(vDate) {
					if (!vDate) return null;
					var sDate = String(vDate).trim();
					if (!sDate) return null;

					if (/^\d+(\.\d+)?$/.test(sDate)) {
						var excelDays = parseFloat(sDate);
						var jsDate = new Date((excelDays - 25569) * 86400 * 1000);
						jsDate = new Date(jsDate.getTime() + jsDate.getTimezoneOffset() * 60000);
						return jsDate;
					}

					var parts;
					if (sDate.indexOf("-") > 0) parts = sDate.split("-");
					else if (sDate.indexOf("/") > 0) parts = sDate.split("/");
					else if (sDate.indexOf(".") > 0) parts = sDate.split(".");

					if (parts && parts.length === 3) {
						if (parts[2].length === 4 || parts[2].length === 2) { 
							var y = Number(parts[2]);
							if (parts[2].length === 2) y += 2000;
							var p0 = Number(parts[0]);
							var p1 = Number(parts[1]);
							if (p0 > 12) {
								return new Date(y, p1 - 1, p0);
							} else if (p1 > 12) {
								return new Date(y, p0 - 1, p1);
							} else {
								return new Date(y, p1 - 1, p0);
							}
						} else if (parts[0].length === 4) { 
							var y = Number(parts[0]);
							var p1 = Number(parts[1]);
							var p2 = Number(parts[2]);
							if (p2 > 12) {
								return new Date(y, p1 - 1, p2);
							} else if (p1 > 12) {
								return new Date(y, p2 - 1, p1);
							} else {
								return new Date(y, p1 - 1, p2);
							}
						}
					}
					var oFallback = new Date(sDate);
					if (!isNaN(oFallback.getTime())) return oFallback;
					return null;
				};

				var oStartDate = fnParseDate(sStart);
				if (!oStartDate || isNaN(oStartDate.getTime())) {
					aResults.push({ status: "Error", id: sId, message: "Invalid Start Date format: " + sStart });
					fnProcessNext();
					return;
				}

				var oMaturityDate = fnParseDate(sMaturity);
				if (!oMaturityDate || isNaN(oMaturityDate.getTime())) {
					aResults.push({ status: "Error", id: sId, message: "Invalid Maturity Date format: " + sMaturity });
					fnProcessNext();
					return;
				}

				var iTenor = 0;
				var sTenorStr = "0.0";
				if (oStartDate && oMaturityDate) {
					// Matches ZFI_FD_MASS_UPLOAD_RPT: total_days / 30.4167 with 1 decimal
					var iTotalDays = Math.round((oMaturityDate.getTime() - oStartDate.getTime()) / (1000 * 60 * 60 * 24));
					if (iTotalDays < 0) iTotalDays = 0;
					var fMonths = iTotalDays / 30.4167;
					sTenorStr = fMonths.toFixed(1);
					iTenor = parseFloat(sTenorStr);
				}

				// Determine if it's a legacy FD based on Fiscal Year (April - March)
				var oToday = new Date();
				var iCurrentYear = oToday.getFullYear();
				var iCurrentMonth = oToday.getMonth(); // 0-indexed, 3 = April
				
				var oFiscalYearStart;
				if (iCurrentMonth >= 3) {
					oFiscalYearStart = new Date(iCurrentYear, 3, 1);
				} else {
					oFiscalYearStart = new Date(iCurrentYear - 1, 3, 1);
				}
				oFiscalYearStart.setHours(0, 0, 0, 0);
				
				var bIsLegacy = false;
				if (oStartDate) {
					var oStartCompare = new Date(oStartDate.getTime());
					oStartCompare.setHours(0, 0, 0, 0);
					if (oStartCompare.getTime() < oFiscalYearStart.getTime()) {
						bIsLegacy = true;
					}
				}

				if (bIsLegacy) {
					var oPayload = {
						CoCode: sCoCode,
						FdAccno: sId,
						BankName: sBank,
						PrincipalAmt: fPrincipal.toFixed(2),
						InterestRate: fRate.toFixed(2),
						StartDate: this._toODataDateTime(oStartDate),
						CREATE_DATE: this._toODataDateTime(new Date()),
						TenorMonths: sTenorStr,
						CompoundFreq: sCompoundFreq,
						OPENING_FD: sOpeningFd,
						GlPrincipal: sGlP,
						BankGl: sBankGL,
						GlReceivable: sGlI,
						GlIncome: sGlInc,
						ProfitCenter: sProfitCenter,
						MATURITY_DATE: this._toODataDateTime(oMaturityDate)
					};

					var aFdProps = this._getFdDetailsProperties ? this._getFdDetailsProperties(oServiceModel) : null;
					if (aFdProps && aFdProps.length > 0) {
						aFdProps.forEach(function(sProp) {
							var sUp = sProp.toUpperCase().replace(/[^A-Z]/g, "");
							if (sUp === "LIENAMT" || sUp === "LIEN") {
								oPayload[sProp] = fLien.toFixed(2);
							} else if (sUp === "NOTLIENAMT" || sUp === "NOTLIEN") {
								oPayload[sProp] = fNotLien.toFixed(2);
							}
						});
					} else {
						oPayload.LIEN_AMT = fLien.toFixed(2);
						oPayload.NOT_LIEN_AMT = fNotLien.toFixed(2);
						oPayload.LienAmt = fLien.toFixed(2);
						oPayload.NotLienAmt = fNotLien.toFixed(2);
					}

					if (sId) {
						try {
							window.localStorage.setItem("FD_LIEN_" + sId, String(fLien));
							window.localStorage.setItem("FD_NOT_LIEN_" + sId, String(fNotLien));
						} catch (e) {}
					}

					FdDetailsService.createLegacyFd(oServiceModel, oPayload, {
						success: function(oResponse) {
							var sDocNo = (oResponse && (oResponse.FdDocNo || oResponse.FD_DOC_NO)) || "--";
							var sMsg = (oResponse && oResponse.Message) || ("Legacy FD " + sId + " uploaded successfully");
							aResults.push({
								status: "Success",
								id: sId,
								type: "L",
								docNo: sDocNo !== "--" ? sDocNo : "-",
								message: sMsg
							});
							fnProcessNext();
						},
						error: function(oError) {
							var sBackendMessage = this._extractODataError(oError);
							aResults.push({
								status: "Error",
								id: sId,
								type: "L",
								docNo: "-",
								message: sBackendMessage || "Failed to create Legacy FD."
							});
							fnProcessNext();
						}.bind(this)
					});
				} else {
					var aFilters = [
						new Filter("CoCode", FilterOperator.EQ, sCoCode),
						new Filter("FdAccno", FilterOperator.EQ, sId),
						new Filter("BankName", FilterOperator.EQ, sBank),
						new Filter("PrincipalAmt", FilterOperator.EQ, fPrincipal),
						new Filter("InterestRate", FilterOperator.EQ, fRate),
						new Filter("StartDate", FilterOperator.EQ, this._toODataDateTime(oStartDate)),
						new Filter("CREATE_DATE", FilterOperator.EQ, this._toODataDateTime(new Date())),
						new Filter("TenorMonths", FilterOperator.EQ, sTenorStr),
						new Filter("CompoundFreq", FilterOperator.EQ, sCompoundFreq),
						new Filter("OpeningFd", FilterOperator.EQ, sOpeningFd),
						new Filter("GlPrincipal", FilterOperator.EQ, sGlP),
						new Filter("BankGl", FilterOperator.EQ, sBankGL),
						new Filter("GlReceivable", FilterOperator.EQ, sGlI),
						new Filter("GlIncome", FilterOperator.EQ, sGlInc),
						new Filter("ProfitCenter", FilterOperator.EQ, sProfitCenter),
						new Filter("MATURITY_DATE", FilterOperator.EQ, this._toODataDateTime(oMaturityDate))
					];

					var sLienProp = this._getAccountingDocLienPropertyName ? this._getAccountingDocLienPropertyName(oServiceModel) : "LIEN_AMT";
					if (sLienProp) {
						aFilters.push(new Filter(sLienProp, FilterOperator.EQ, String(fLien)));
					}

					if (sId) {
						try {
							window.localStorage.setItem("FD_LIEN_" + sId, String(fLien));
							window.localStorage.setItem("FD_NOT_LIEN_" + sId, String(fNotLien));
						} catch (e) {}
					}

					FdDetailsService.generateAccountingDoc(oServiceModel, {
						filters: aFilters,
						success: function(oResponse) {
							var oResult = (oResponse && oResponse.results && oResponse.results[0]) || {};
							var sDocNo = oResult.FdDocNo || oResult.FD_DOC_NO || "--";
							var sMsg = oResult.Message || (sDocNo !== "--" ? ("Accounting Document " + sDocNo + " generated") : "New FD Created Successfully");
							aResults.push({
								status: "Success",
								id: sId,
								type: "N",
								docNo: sDocNo,
								message: sMsg
							});
							fnProcessNext();
						},
						error: function(oError) {
							var sBackendMessage = this._extractODataError(oError);
							aResults.push({
								status: "Error",
								id: sId,
								type: "N",
								docNo: "-",
								message: sBackendMessage || "Failed to create New FD."
							});
							fnProcessNext();
						}.bind(this)
					});
				}
			}.bind(this);

			fnProcessNext();
		},

		_showMassUploadSummary: function(aResults) {
			var oModel = new JSONModel(aResults);
			var oTableControl = new Table({
				columns: [
					new Column({ width: "140px", header: new Text({ text: "FD Account Number" }) }),
					new Column({ width: "90px", hAlign: "Center", header: new Text({ text: "FD Type" }) }),
					new Column({ width: "140px", header: new Text({ text: "Document No" }) }),
					new Column({ width: "100px", hAlign: "Center", header: new Text({ text: "Status" }) }),
					new Column({ header: new Text({ text: "Message" }) })
				]
			});
			oTableControl.setModel(oModel);
			oTableControl.bindItems("/", new ColumnListItem({
				cells: [
					new Text({ text: "{id}" }),
					new Text({ text: "{type}" }),
					new Text({ text: "{docNo}", class: "fdMono" }),
					new ObjectStatus({
						text: "{status}",
						state: "{= ${status} === 'Success' ? 'Success' : 'Error' }"
					}),
					new Text({ text: "{message}" })
				]
			}));

			var bHasErrors = aResults.some(function(r) { return r.status === "Error"; });
			var aButtons = [];
			
			if (bHasErrors) {
				aButtons.push(new Button({
					text: "Download Errors",
					icon: "sap-icon://download",
					press: function() {
						this._downloadErrorLog(aResults);
					}.bind(this)
				}));
			}

			var oDialog = new Dialog({
				title: "Mass Upload Summary",
				contentWidth: "600px",
				contentHeight: "400px",
				verticalScrolling: true,
				content: [oTableControl],
				buttons: aButtons,
				endButton: new Button({
					text: "Close",
					press: function() {
						oDialog.close();
					}
				}),
				afterClose: function() {
					oDialog.destroy();
					this._refresh();
				}.bind(this)
			});

			this.getView().addDependent(oDialog);
			oDialog.open();
		},

		_downloadErrorLog: function(aResults) {
			var aErrors = aResults.filter(function(r) { return r.status === "Error"; });
			if (aErrors.length === 0) return;
			
			var escapeCsv = function(val) {
				var str = String(val || "").replace(/"/g, '""');
				return '"' + str + '"';
			};

			var sCsv = "FD Number,Status,Message\n";
			aErrors.forEach(function(oRow) {
				sCsv += escapeCsv(oRow.id) + "," + escapeCsv(oRow.status) + "," + escapeCsv(oRow.message) + "\n";
			});

			var oBlob = new Blob([sCsv], { type: "text/csv;charset=utf-8;" });
			var sUrl = URL.createObjectURL(oBlob);
			
			var oLink = document.createElement("a");
			oLink.href = sUrl;
			oLink.download = "Mass_Upload_Errors.csv";
			document.body.appendChild(oLink);
			oLink.click();
			document.body.removeChild(oLink);
			URL.revokeObjectURL(sUrl);
		},

		onRunMonthEnd: function() {
			var oTable = this.byId("fdTable");
			if (!oTable) return;

			var aContexts = oTable.getSelectedContexts();
			if (!aContexts || aContexts.length === 0) {
				MessageBox.error("Please select at least one Fixed Deposit.");
				return;
			}

			var aSelectedFds = aContexts.map(function(oContext) {
				return oContext.getObject();
			});

			var sMonth = this._fmtMonthYear(new Date());
			var aBlockedMessages = [];
			var aEligibleFds = [];

			aSelectedFds.forEach(function(oFd) {
				if (oFd.status === "matured") {
					aBlockedMessages.push(
						"FD " + oFd.id + " matured on " + oFd.maturityText + ". Month End Not Allowed"
					);
				} else {
					aEligibleFds.push(oFd);
				}
			});

			if (aBlockedMessages.length) {
				MessageBox.error(aBlockedMessages.join("\n"));
			}

			if (!aEligibleFds.length) {
				return;
			}

			var oDatePicker = new DatePicker({
				valueFormat: "yyyy-MM-dd",
				displayFormat: "dd MMM yyyy",
				dateValue: new Date()
			});

			var oDialog = new Dialog({
				title: "Month End - " + sMonth,
				content: [
					new VBox({
						items: [
							new Text({ text: "Run Month End for " + aEligibleFds.length + " selected Fixed Deposit(s)?\n\nPlease select Entry Date:" }),
							oDatePicker
						]
					}).addStyleClass("sapUiSmallMargin")
				],
				beginButton: new Button({
					text: "Run",
					type: "Emphasized",
					press: function() {
						var oSelectedDate = oDatePicker.getDateValue();
						if (!oSelectedDate) {
							MessageBox.error("Please select an entry date.");
							return;
						}
						this._processMonthEnd(aEligibleFds, oTable, oSelectedDate);
						oDialog.close();
					}.bind(this)
				}),
				endButton: new Button({
					text: "Cancel",
					press: function() {
						oDialog.close();
					}
				}),
				afterClose: function() {
					oDialog.destroy();
				}
			});
			
			this.getView().addDependent(oDialog);
			oDialog.open();
		},

		_processMonthEnd: function(aSelectedFds, oTable, oPostingDate) {
			aSelectedFds.forEach(function(fd) {
				try {
					localStorage.setItem("MonthEndDate_" + fd.id, oPostingDate.toISOString());
				} catch (e) {}
			});

			var oBusy = new BusyDialog({ text: "Running Month End..." });
			oBusy.open();

			var oServiceModel = this.getOwnerComponent().getModel();
			if (!oServiceModel || !oServiceModel.read) {
				oBusy.close();
				MessageBox.error("OData Service is unavailable.");
				return;
			}

			var aPromises = aSelectedFds.map(function(oFd) {
				return new Promise(function(resolve) {
					var padTo10 = function(sVal) {
						var sTrimmed = (sVal || "").trim();
						if (sTrimmed && /^\d+$/.test(sTrimmed) && sTrimmed.length < 10) {
							return "0000000000".substring(0, 10 - sTrimmed.length) + sTrimmed;
						}
						return sTrimmed;
					};

					if (!oFd.glP || !oFd.glI || !oFd.glInc || !oFd.profitCenter) {
						resolve({ status: "Error", id: oFd.id, message: "GL Accounts or Profit Center are missing." });
						return;
					}

					var sSelectedMonth = this._fmtMonthYear(oPostingDate);
					var aProcessedMonths = [];
					try {
						var sProcessed = localStorage.getItem("MonthEndProcessed_" + oFd.id);
						if (sProcessed) {
							aProcessedMonths = JSON.parse(sProcessed);
						}
					} catch(e) {}

					if (aProcessedMonths.indexOf(sSelectedMonth) !== -1) {
						resolve({
							status: "Error",
							id: oFd.id,
							message: "Month end performed against this fd for the month of " + sSelectedMonth
						});
						return;
					}

					var oStartDate = oFd.start ? this._toODataDateTime(oFd.start) : null;
					var oMonthEndDate = oPostingDate ? this._toODataDateTime(oPostingDate) : null;
					var oCreateDate = oFd.creationDate ? this._toODataDateTime(oFd.creationDate) : null;

					var bStartDateValid = oStartDate instanceof Date && !isNaN(oStartDate.getTime());
					var bCreateDateValid = oCreateDate instanceof Date && !isNaN(oCreateDate.getTime());
					var bMonthEndDateValid = oMonthEndDate instanceof Date && !isNaN(oMonthEndDate.getTime());

					var aFilters = [
						new Filter("CoCode", FilterOperator.EQ, oFd.coCode || ""),
						new Filter("FdAccno", FilterOperator.EQ, oFd.id || ""),
						new Filter("BankName", FilterOperator.EQ, oFd.bank || ""),
						new Filter("PrincipalAmt", FilterOperator.EQ, String(oFd.principal || "0")),
						new Filter("InterestRate", FilterOperator.EQ, String(oFd.rate || "0"))
					];

					if (bStartDateValid) {
						aFilters.push(new Filter("StartDate", FilterOperator.EQ, oStartDate));
					}

					if (bCreateDateValid) {
						aFilters.push(new Filter("CREATE_DATE", FilterOperator.EQ, oCreateDate));
					}

					if (bMonthEndDateValid) {
						var sMonthEndDateStr = this._dateToIso(oMonthEndDate).replace(/-/g, ""); // e.g. "20240917"
						aFilters.push(new Filter("MONTH_END_DATE", FilterOperator.EQ, sMonthEndDateStr));
					}

					// Implement interest calculation for month-end posting
					console.log("=== RUNNING NEW CUMULATIVE INTEREST LOGIC ===");
					var fPrincipal = Number(oFd.principal || 0);
					var fRate = Number(oFd.rate || 0) / 100;
					var oCalcStartDate = oFd.start ? this._startOfDay(new Date(oFd.start + "T00:00:00")) : null;
					var oCalcMaturity = this._startOfDay(this._maturityDate(oFd));
					var oCalcPostingDate = this._startOfDay(oPostingDate);
					
					var oCalculationDate = oCalcMaturity < oCalcPostingDate ? oCalcMaturity : oCalcPostingDate;
					
					var iCumulativeDays = (oCalculationDate >= oCalcStartDate) ? this._daysBetween(oCalcStartDate, oCalculationDate) + 1 : 0;
					var fCumulativeInterest = (fPrincipal * fRate * iCumulativeDays) / 365;
					
					var fPrevCumulativeInterest = 0;
					try {
						var sStoredCum = localStorage.getItem("MonthEndCumInt_" + oFd.id);
						if (sStoredCum) {
							fPrevCumulativeInterest = parseFloat(sStoredCum);
						}
					} catch (e) {}
					
					var fMonthlyInterest = fCumulativeInterest - fPrevCumulativeInterest;
					if (fMonthlyInterest < 0) fMonthlyInterest = 0;

					aFilters.push(
						new Filter("TenorMonths", FilterOperator.EQ, String(oFd.tenor || "")),
						new Filter("CompoundFreq", FilterOperator.EQ, this._compoundFreqText(oFd.freq)),
						new Filter("OpeningFd", FilterOperator.EQ, oFd.openingFd || ""),
						new Filter("GlPrincipal", FilterOperator.EQ, this.padTo10(oFd.glP)),
						new Filter("BankGl", FilterOperator.EQ, this.padTo10(oFd.bankGL)),
						new Filter("GlReceivable", FilterOperator.EQ, this.padTo10(oFd.glI)),
						new Filter("GlIncome", FilterOperator.EQ, this.padTo10(oFd.glInc)),
						new Filter("ProfitCenter", FilterOperator.EQ, this.padTo10(oFd.profitCenter)),
						new Filter("MATURITY_DATE", FilterOperator.EQ, this._toODataDateTime(this._maturityDate(oFd))),
						new Filter("INTEREST_AMT", FilterOperator.EQ, String(fCumulativeInterest)),
						new Filter("LV_IND", FilterOperator.EQ, "X")
					);

					oServiceModel.read("/AccountingDocSet", {
						filters: aFilters,
						success: function (oResponse) {
							var oResult = (oResponse && oResponse.results && oResponse.results[0]) || {};
							var sDocNo = oResult.FdDocNo || oResult.FD_DOC_NO || "--";
							var sRevNo = oResult.FdRevNo || oResult.FD_REV_NO || "--";

							var oOriginalFd = this._fds.find(function (f) {
								return f.id === oFd.id;
							});

							if (oOriginalFd) {
								oOriginalFd.lvInd = "X";
								oOriginalFd.monthEndDocNo = sDocNo;
								oOriginalFd.monthEndRevNo = sRevNo;
							}

							oFd.lvInd = "X";
							oFd.monthEndDocNo = sDocNo;
							oFd.monthEndRevNo = sRevNo;

							try {
								localStorage.setItem("MonthEndCumInt_" + oFd.id, String(fCumulativeInterest));
								
								// Also save the month to the processed list so they can't run it again
								if (aProcessedMonths.indexOf(sSelectedMonth) === -1) {
									aProcessedMonths.push(sSelectedMonth);
									localStorage.setItem("MonthEndProcessed_" + oFd.id, JSON.stringify(aProcessedMonths));
								}
							} catch (e) {}

							resolve({
								status: "Success",
								id: oFd.id,
								docNo: sDocNo,
								revNo: sRevNo,
								message: "Month End posted successfully"
							});
						}.bind(this),
						error: function (oError) {
							var sBackendMessage = this._extractODataError(oError);

							if (sBackendMessage && sBackendMessage.toLowerCase().indexOf("already processed") !== -1) {
								sBackendMessage = "Month end performed against this fd for the month of " + this._fmtMonthYear(oPostingDate);
							}

							resolve({
								status: "Error",
								id: oFd.id,
								message: sBackendMessage || "Failed to process Month End."
							});
						}.bind(this)
					});
				}.bind(this));
			}.bind(this));

			Promise.all(aPromises).then(function (aResults) {
				oBusy.close();
				oTable.removeSelections(true);
				this.getView().getModel().setData(this._buildAppData());

				var oModel = new JSONModel(aResults);
				var oTableControl = new Table({
					columns: [
						new Column({ header: new Text({ text: "FD Number" }) }),
						new Column({ header: new Text({ text: "Status" }) }),
						new Column({ header: new Text({ text: "Message" }) })
					]
				});
				oTableControl.setModel(oModel);
				oTableControl.bindItems("/", new ColumnListItem({
					cells: [
						new Text({ text: "{id}" }),
						new ObjectStatus({
							text: "{status}",
							state: "{= ${status} === 'Success' ? 'Success' : 'Error' }"
						}),
						new Text({ text: "{message}" })
					]
				}));

				var oDialog = new Dialog({
					title: "Month End Batch Summary",
					contentWidth: "700px",
					content: [oTableControl],
					endButton: new Button({
						text: "Close",
						press: function () { oDialog.close(); oDialog.destroy(); }
					})
				});
				this.getView().addDependent(oDialog);
				oDialog.open();
			}.bind(this));
		}
	});
});