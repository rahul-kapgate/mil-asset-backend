import { Router } from "express";
import { verifyAccessToken } from "../utils/jwt.js";
import { listAuditLogs } from "../controllers/audit.controller.js";

const router = Router();

router.get("/", verifyAccessToken, listAuditLogs);

export default router;
