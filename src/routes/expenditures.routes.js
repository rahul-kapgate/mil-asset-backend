import { Router } from "express";
import { createExpenditure, listExpenditures } from "../controllers/expenditures.controller.js";

const router = Router();

router.post("/", createExpenditure);
router.get("/", listExpenditures);

export default router;
