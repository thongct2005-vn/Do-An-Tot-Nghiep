const walletRepository = require("./wallet.repository");
const createWalletService = require("./wallet.service");
const createWalletController = require("./wallet.controller");
const createWalletRoutes = require("./wallet.routes");


module.exports = () => {

  const repository = Object.create(walletRepository);
  const service = createWalletService({ walletRepository: repository });
  const controller = createWalletController(service);
  const router = createWalletRoutes(controller);
  return { repository, service, controller, router };
};