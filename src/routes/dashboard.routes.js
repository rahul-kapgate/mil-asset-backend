import { Router } from "express";
import { dashboardSummary, netMovementDetails } from "../controllers/dashboard.controller.js";

const router = Router();

router.get("/summary", dashboardSummary);
router.get("/net-movement", netMovementDetails);

export default router;
