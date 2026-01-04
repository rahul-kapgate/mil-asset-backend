import { Router } from "express";
import basesRoutes from "./bases.routes.js";
import equipmentRoutes from "./equipment.routes.js";

const router = Router();

router.use("/bases", basesRoutes);
router.use("/equipment-types", equipmentRoutes);

export default router;
