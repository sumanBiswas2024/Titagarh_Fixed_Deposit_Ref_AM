sap.ui.define([
	"./BaseController"
], function(BaseController) {
	"use strict";

	return BaseController.extend("com.infocus.zfifixeddepositZFI_FIXED_DEPOSIT.controller.LegacyFD", {
        onLegacyMaturityChange: function() {
            var oModel = this.getView().getModel("legacyFd");
            var oData = oModel.getData();
            var sStart = oData.start;
            var sMaturity = oData.maturityDate;
            
            if (!sStart || !sMaturity) {
                return;
            }
            
            var oStart = new Date(sStart);
            var oMat = new Date(sMaturity);
            
            if (isNaN(oStart.getTime()) || isNaN(oMat.getTime())) {
                return;
            }
            
            var iMonths = (oMat.getFullYear() - oStart.getFullYear()) * 12;
            iMonths -= oStart.getMonth();
            iMonths += oMat.getMonth();
            
            var iDays = oMat.getDate() - oStart.getDate();
            
            if (iDays < 0) {
                iMonths -= 1;
                var prevMonth = new Date(oMat.getFullYear(), oMat.getMonth(), 0);
                iDays += prevMonth.getDate();
            }
            
            if (iMonths < 0) {
                iMonths = 0;
                iDays = 0;
            }
            
            var iTotalMonths = iMonths + (iDays / 30);
            oModel.setProperty("/tenor", iTotalMonths.toFixed(2));
            
            var iYears = Math.floor(iMonths / 12);
            var iRemainingMonths = iMonths % 12;
            
            var aTextParts = [];
            if (iYears > 0) aTextParts.push(iYears + (iYears === 1 ? " Year" : " Years"));
            if (iRemainingMonths > 0) aTextParts.push(iRemainingMonths + (iRemainingMonths === 1 ? " Month" : " Months"));
            if (iDays > 0) aTextParts.push(iDays + (iDays === 1 ? " Day" : " Days"));
            
            oModel.setProperty("/tenorText", aTextParts.length > 0 ? aTextParts.join(" ") : "0 Days");
        },

        onLegacyPrincipalChange: function() {
            this._recalculateLienAndNotLien("legacyFd");
        },

        onLegacyLienAmountChange: function() {
            this._recalculateLienAndNotLien("legacyFd");
        }
	});
});
