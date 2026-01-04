import { Router } from "express";
import { verifyAccessToken } from "../utils/jwt.js";
import { createPurchase, listPurchases } from "../controllers/purchases.controller.js";

const router = Router();

router.post("/", verifyAccessToken, createPurchase);
router.get("/", verifyAccessToken, listPurchases);

export default router;
