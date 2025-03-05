export const FREE_PLAN = {
  id: "free",
  metadata: {
    show_on_table: true,
  },
  product: {
    name: "Free",
    metadata: {
      features: `
				Unlimited Assets, 
				Chat support, 
				3 Custom Fields, 
				Github Support, 
				TLS (SSL) Included, 
				Automatic Upgrades, 
				Server Maintenance
			`,
      slogan: "For personal use or hobby use.",
    },
  },
  unit_amount: 0,
  currency: "usd",
  recurring: {
    interval: "month",
  },
};
