export const requireRole = (roles) => {
    return (req, res, next) => {
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
