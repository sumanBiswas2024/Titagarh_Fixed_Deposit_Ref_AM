sap.ui.define([
    "./BaseController",
    "sap/m/MessageToast"
], function (BaseController, MessageToast) {
    "use strict";

    return BaseController.extend(
        "com.infocus.zfifixeddepositZFI_FIXED_DEPOSIT.controller.NewFD", {

        onTenureChange: function() {
            var oModel = this.getView().getModel("newFd");
            var oData = oModel.getData();
            var iYears = parseInt(oData.tenorYears, 10) || 0;
            var iMonths = parseInt(oData.tenorMonths, 10) || 0;
            var iDays = parseInt(oData.tenorDays, 10) || 0;
            
            var sStart = oData.start;
            if (!sStart) {
                return;
            }
            
            var oDate = new Date(sStart);
            if (isNaN(oDate.getTime())) {
                return;
            }
            
            oDate.setFullYear(oDate.getFullYear() + iYears);
            oDate.setMonth(oDate.getMonth() + iMonths);
            oDate.setDate(oDate.getDate() + iDays);
            
            var sMaturity = this._dateToIso(oDate);
            oModel.setProperty("/calculatedMaturity", sMaturity);
            
            // Calculate equivalent tenor months for backend
            var iTotalMonths = (iYears * 12) + iMonths + (iDays / 30);
            oModel.setProperty("/tenor", iTotalMonths.toFixed(2));
        },

        onPrincipalChange: function() {
            this._recalculateLienAndNotLien("newFd");
        },

        onLienAmountChange: function() {
            this._recalculateLienAndNotLien("newFd");
        }

    });

});