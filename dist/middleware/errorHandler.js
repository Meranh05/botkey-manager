export const errorHandler = (err, _req, res, _next) => {
    res.status(500).json({ error: "internal_error", message: err.message });
};
