sap.ui.define([
	"./BaseController",
	"sap/ui/model/json/JSONModel",
	"sap/ui/unified/DateTypeRange"
], function(BaseController, JSONModel, DateTypeRange) {
	"use strict";

	return BaseController.extend("com.infocus.zfifixeddepositZFI_FIXED_DEPOSIT.controller.MaturityCalendar", {

		onInit: function() {
			BaseController.prototype.onInit.apply(this, arguments);
			
			this._oCalModel = new JSONModel({
				selectedDateText: "today",
				maturingCount: 0,
				maturingFds: []
			});
			this.getView().setModel(this._oCalModel, "cal");

			var oRouter = this.getOwnerComponent().getRouter();
			oRouter.getRoute("maturityCalendar").attachPatternMatched(this._onRouteMatched, this);
		},

		_onRouteMatched: function() {
			this._populateCalendarDates();
		},

		_refresh: function() {
			BaseController.prototype._refresh.apply(this, arguments);
			
			// Only update calendar if data is available
			var oModel = this.getView().getModel();
			if (oModel && oModel.getProperty("/fds") && oModel.getProperty("/fds").length > 0) {
				this._populateCalendarDates();
				
				var oCalendar = this.byId("maturityCalendar");
				var aSelectedDates = oCalendar.getSelectedDates();
				if (aSelectedDates && aSelectedDates.length > 0) {
					this._selectDate(aSelectedDates[0].getStartDate());
				} else {
					this._selectDate(new Date());
				}
			}
		},

		_populateCalendarDates: function() {
			var oCalendar = this.byId("maturityCalendar");
			oCalendar.removeAllSpecialDates();

			var oModel = this.getView().getModel();
			if (!oModel) return;

			var aFds = oModel.getProperty("/fds") || [];
			
			aFds.forEach(function(oFd) {
				if (oFd.status === "active") {
					var oDate = this._maturityDate(oFd);
					if (oDate) {
						// Add a DateTypeRange (Type01 is standard indicator)
						oCalendar.addSpecialDate(new DateTypeRange({
							startDate: oDate,
							type: "Type01",
							tooltip: "FD Maturing"
						}));
					}
				}
			}.bind(this));
		},

		onSelectDate: function(oEvent) {
			var oCalendar = oEvent.getSource();
			var aSelectedDates = oCalendar.getSelectedDates();
			
			if (aSelectedDates && aSelectedDates.length > 0) {
				var oDate = aSelectedDates[0].getStartDate();
				this._selectDate(oDate);
			}
		},

		_selectDate: function(oDate) {
			if (!oDate) return;
			
			// Format date for display
			var oFormat = sap.ui.core.format.DateFormat.getDateInstance({pattern: "MMM dd, yyyy"});
			this._oCalModel.setProperty("/selectedDateText", oFormat.format(oDate));
			
			var oModel = this.getView().getModel();
			if (!oModel) return;

			var aFds = oModel.getProperty("/fds") || [];
			var aMaturing = [];
			
			// Compare date strings to ignore time/timezone mismatches
			var sTargetDate = oDate.getFullYear() + "-" + oDate.getMonth() + "-" + oDate.getDate();
			
			aFds.forEach(function(oFd) {
				if (oFd.status === "active") {
					var oFdDate = this._maturityDate(oFd);
					if (oFdDate) {
						var sFdDate = oFdDate.getFullYear() + "-" + oFdDate.getMonth() + "-" + oFdDate.getDate();
						if (sTargetDate === sFdDate) {
							aMaturing.push(oFd);
						}
					}
				}
			}.bind(this));
			
			this._oCalModel.setProperty("/maturingFds", aMaturing);
			this._oCalModel.setProperty("/maturingCount", aMaturing.length);
		}
	});
});
