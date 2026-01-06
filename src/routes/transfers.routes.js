import { Router } from "express";
import {
  createTransfer,
  approveTransfer,
  dispatchTransfer,
  receiveTransfer,
  listTransfers,
} from "../controllers/transfers.controller.js";

const router = Router();

router.post("/", createTransfer);
router.post("/:id/approve", approveTransfer);
router.post("/:id/dispatch", dispatchTransfer);
router.post("/:id/receive", receiveTransfer);

router.get("/", listTransfers);

export default router;
