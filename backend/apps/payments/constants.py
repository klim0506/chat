# Trial period for new users (days). After it ends, subscription expires and free limits apply.
TRIAL_PERIOD_DAYS = 5

# Subscription plans: (months, total kopecks, per_month kopecks, original_full kopecks, discount_pct)
# Monthly: 299 RUB
# 6 months: 229 RUB/mo, 1374 total (was 1794), -23%
# 12 months: 159 RUB/mo, 1908 total (was 3588), -47%
# 24 months: 119 RUB/mo, 2856 total (was 7176), -60%
SUBSCRIPTION_PLANS = {
    1: {"total_kopecks": 29900, "per_month_kopecks": 29900, "original_kopecks": 29900, "discount_pct": 0},
    6: {"total_kopecks": 137400, "per_month_kopecks": 22900, "original_kopecks": 179400, "discount_pct": 23},
    12: {"total_kopecks": 190800, "per_month_kopecks": 15900, "original_kopecks": 358800, "discount_pct": 47},
    24: {"total_kopecks": 285600, "per_month_kopecks": 11900, "original_kopecks": 717600, "discount_pct": 60},
}

# Referral milestones: invited_count -> subscription months granted
REFERRAL_MILESTONES = {
    10: 1,   # 10 invited -> 1 month
    40: 6,   # 40 invited -> 6 months
    80: 12,  # 80 invited -> 1 year
}
