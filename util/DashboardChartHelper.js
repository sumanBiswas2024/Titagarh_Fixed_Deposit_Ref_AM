sap.ui.define([], function () {
	"use strict";

	return {
		/**
		 * Calculate average interest rate of all active FDs on the basis of Principal & Interest Amount:
		 * Average interest = (interest calculated / base value) * 100
		 */
		getAverageInterestRate: function (aFds) {
			if (!aFds || aFds.length === 0) return "0.00%";
			var aActive = aFds.filter(function(fd) { return fd.status === "active"; });
			if (aActive.length === 0) return "0.00%";

			var totalBaseValue = 0;
			var totalInterest = 0;
			aActive.forEach(function (fd) {
				var p = parseFloat(String(fd.principal || 0).replace(/,/g, "")) || 0;
				var r = parseFloat(String(fd.rate || 0).replace(/,/g, "")) || 0;
				var i = (fd.interest !== undefined && !isNaN(parseFloat(fd.interest)) && parseFloat(fd.interest) > 0)
					? parseFloat(fd.interest)
					: (p * r) / 100;
				totalBaseValue += p;
				totalInterest += i;
			});

			if (totalBaseValue <= 0) return "0.00%";
			var avg = (totalInterest / totalBaseValue) * 100;
			return avg.toFixed(2) + "%";
		},

		/**
		 * Build Top Performing Banks Ranking
		 */
		getTopBanks: function (aFds) {
			if (!aFds) return [];
			var aActive = aFds.filter(function(fd) { return fd.status === "active"; });
			var bankRates = {};
			aActive.forEach(function (fd) {
				var bank = fd.bank || "Unknown";
				var rate = parseFloat(fd.rate || 0);
				if (!bankRates[bank] || rate > bankRates[bank]) {
					bankRates[bank] = rate;
				}
			});

			var sortedBanks = Object.keys(bankRates).map(function (bank) {
				return { bank: bank, rate: bankRates[bank], rateText: bankRates[bank].toFixed(2) + "%" };
			}).sort(function (a, b) {
				return b.rate - a.rate;
			});

			return sortedBanks.slice(0, 5);
		},

		/**
		 * Build Upcoming Maturities by Month (Count)
		 */
		getMaturitiesByMonth: function (aFds, oAsOfDate) {
			if (!aFds) return [];
			var aActive = aFds.filter(function(fd) { return fd.status === "active"; });
			var monthData = {};
			var monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
			
			var today = oAsOfDate || new Date();
			for(var i=0; i<6; i++) {
				var d = new Date(today.getFullYear(), today.getMonth() + i, 1);
				monthData[monthNames[d.getMonth()] + " " + d.getFullYear()] = { count: 0, amount: 0 };
			}

			aActive.forEach(function (fd) {
				if (fd.maturity) {
					var date = fd.maturity instanceof Date ? fd.maturity : new Date(fd.maturity);
					if (!isNaN(date.getTime())) {
						var key = monthNames[date.getMonth()] + " " + date.getFullYear();
						if (monthData[key] !== undefined) {
							monthData[key].count++;
							monthData[key].amount += parseFloat(fd.principal || 0);
						}
					}
				}
			});

			return Object.keys(monthData).map(function(key) {
				return { month: key, count: monthData[key].count, amount: monthData[key].amount };
			});
		},

		/**
		 * Build Portfolio Trend (Sum of Principal Active in recent months)
		 */
		getPortfolioTrend: function (aFds, oAsOfDate) {
			if (!aFds) return [];
			var monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
			var trend = [];
			var today = oAsOfDate || new Date();
			
			// Let's generate a trend for the last 6 months
			for(var i=5; i>=0; i--) {
				var d = new Date(today.getFullYear(), today.getMonth() - i, 1);
				var monthKey = monthNames[d.getMonth()] + " " + d.getFullYear();
				
				// Calculate principal active in that month
				var monthPrincipal = 0;
				aFds.forEach(function(fd) {
					var start = fd.start instanceof Date ? fd.start : new Date(fd.start);
					var maturity = fd.maturity instanceof Date ? fd.maturity : new Date(fd.maturity);
					if (!isNaN(start.getTime()) && start <= new Date(d.getFullYear(), d.getMonth() + 1, 0)) {
						if (isNaN(maturity.getTime()) || maturity >= d) {
							monthPrincipal += parseFloat(fd.principal || 0);
						}
					}
				});
				
				trend.push({ month: monthKey, amount: (monthPrincipal / 100000) });
			}
			return trend;
		},

		/**
		 * Build Monthly Interest Accrual Trend
		 */
		getInterestTrend: function (aFds, oAsOfDate) {
			if (!aFds) return [];
			var monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
			var trend = [];
			var today = oAsOfDate || new Date();
			
			// Let's generate an interest trend for the last 6 months
			for(var i=5; i>=0; i--) {
				var d = new Date(today.getFullYear(), today.getMonth() - i, 1);
				var monthKey = monthNames[d.getMonth()] + " " + d.getFullYear();
				
				var monthInterest = 0;
				aFds.forEach(function(fd) {
					var start = fd.start instanceof Date ? fd.start : new Date(fd.start);
					var maturity = fd.maturity instanceof Date ? fd.maturity : new Date(fd.maturity);
					if (!isNaN(start.getTime()) && start <= new Date(d.getFullYear(), d.getMonth() + 1, 0)) {
						if (isNaN(maturity.getTime()) || maturity >= d) {
							// Roughly estimate monthly interest: Principal * Rate / 12
							var p = parseFloat(fd.principal || 0);
							var r = parseFloat(fd.rate || 0) / 100;
							monthInterest += (p * r) / 12;
						}
					}
				});
				
				trend.push({ month: monthKey, interest: (monthInterest / 100000) });
			}
			return trend;
		},

		/**
		 * Build Lien vs Not Lien Amount Breakdown for Pie / Donut Chart
		 */
		getLienAllocation: function (aFds, fCorpus) {
			if (!aFds) return [];
			var aActive = aFds.filter(function(fd) { return fd.status === "active"; });
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

			return [
				{
					category: "Not Lien",
					amount: fNotLienSum,
					amountInLakhs: (fNotLienSum / 100000),
					percent: fNotLienPercent,
					percentText: fNotLienPercent.toFixed(1) + "%",
					color: "#059669"
				},
				{
					category: "Lien",
					amount: fLienSum,
					amountInLakhs: (fLienSum / 100000),
					percent: fLienPercent,
					percentText: fLienPercent.toFixed(1) + "%",
					color: "#D97706"
				}
			];
		}
	};
});