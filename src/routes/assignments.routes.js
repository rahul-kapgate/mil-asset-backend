import { Router } from "express";
import { createAssignment, listAssignments } from "../controllers/assignments.controller.js";

const router = Router();

router.post("/", createAssignment);
router.get("/", listAssignments);

export default router;
