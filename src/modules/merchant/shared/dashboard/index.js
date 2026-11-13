const modes = require("../../modes");
const dashboardRepository = require("./dashboard.repository");
const createDashboardService = require("./dashboard.service");
const createDashboardController = require("./dashboard.controller");
const createDashboardRoutes = require("./dashboard.routes");

module.exports = (mode) => {
  const options = modes[mode];
  if (!options) throw new Error(`Mode không hợp lệ: ${mode}`);

  const service = createDashboardService({ dashboardRepository, ...options });
  const controller = createDashboardController(service);
  return createDashboardRoutes(controller);
};
