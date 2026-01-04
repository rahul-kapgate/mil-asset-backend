import { Router } from "express";
import { verifyAccessToken } from "../utils/jwt.js";
import {
  createTransfer,
  approveTransfer,
  dispatchTransfer,
  receiveTransfer,
  listTransfers,
} from "../controllers/transfers.controller.js";

const router = Router();

router.post("/", verifyAccessToken, createTransfer);
router.post("/:id/approve", verifyAccessToken, approveTransfer);
router.post("/:id/dispatch", verifyAccessToken, dispatchTransfer);
router.post("/:id/receive", verifyAccessToken, receiveTransfer);

router.get("/", verifyAccessToken, listTransfers);

export default router;
