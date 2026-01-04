import { Router } from "express";
import { verifyAccessToken } from "../utils/jwt.js";
import { createAssignment, listAssignments } from "../controllers/assignments.controller.js";

const router = Router();

router.post("/", verifyAccessToken, createAssignment);
router.get("/", verifyAccessToken, listAssignments);

export default router;
