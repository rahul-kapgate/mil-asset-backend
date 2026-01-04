import { Router } from "express";
import { login, register, refresh } from "../controllers/auth.controller.js";

const router = Router();

router.post("/register", register);
router.post("/login", login);

//ref token 
router.post("/refresh", refresh);

export default router;
