import { Router } from "express";
import { verifyAccessToken } from "../utils/jwt.js";
import { createExpenditure, listExpenditures } from "../controllers/expenditures.controller.js";

const router = Router();

router.post("/", verifyAccessToken, createExpenditure);
router.get("/", verifyAccessToken, listExpenditures);

export default router;
