// Error tipado con status HTTP, usado por la capa de servicios para que el controller
// solo tenga que hacer `res.status(error.status || 500).json({ error: error.message })`.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = HttpError;
