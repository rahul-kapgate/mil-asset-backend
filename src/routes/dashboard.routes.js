import { Router } from "express";
import { verifyAccessToken } from "../utils/jwt.js";
import { dashboardSummary, netMovementDetails } from "../controllers/dashboard.controller.js";

const router = Router();

router.get("/summary", verifyAccessToken, dashboardSummary);
router.get("/net-movement", verifyAccessToken, netMovementDetails);

export default router;
