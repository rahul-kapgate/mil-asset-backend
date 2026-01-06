import { Router } from "express";
import { createPurchase, listPurchases } from "../controllers/purchases.controller.js";

const router = Router();

router.post("/", createPurchase);
router.get("/", listPurchases);

export default router;
