import { NextFunction, Request, Response } from "express";

export const requireRole = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.auth;
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const hasRole = user.roles.some((role) => roles.includes(role));
    if (!hasRole) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  };
};
