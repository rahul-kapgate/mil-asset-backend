import { Router } from "express";

import { authenticate } from "../middleware/auth.middleware.js";

import basesRoutes from "./bases.routes.js";
import equipmentRoutes from "./equipment.routes.js";
import purchasesRoutes from "./purchases.routes.js";
import transfersRoutes from "./transfers.routes.js";
import assignmentsRoutes from "./assignments.routes.js";
import expendituresRoutes from "./expenditures.routes.js";
import dashboardRoutes from "./dashboard.routes.js";
import auditRoutes from "./audit.routes.js";

const router = Router();

// Protect ALL /api/v1 routes
router.use(authenticate);

router.use("/bases", basesRoutes);
router.use("/equipment-types", equipmentRoutes);

router.use("/purchases", purchasesRoutes);
router.use("/transfers", transfersRoutes);
router.use("/assignments", assignmentsRoutes);
router.use("/expenditures", expendituresRoutes);

router.use("/dashboard", dashboardRoutes);
router.use("/audit-logs", auditRoutes);

export default router;
