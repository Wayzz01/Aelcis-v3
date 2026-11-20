function epicError(errorCode, errorMessage, numericErrorCode, messageVars, statusCode = 400) {
  const err = new Error(errorMessage || errorCode);
  err.status = statusCode;
  err.body = {
    errorCode: errorCode || "errors.com.epicgames.common.bad_request",
    errorMessage: errorMessage || "Bad request",
    messageVars: messageVars || [],
    numericErrorCode: numericErrorCode || 1001,
    originatingService: "fortnite",
    intent: "prod-live",
    error_description: errorMessage || "Bad request",
    error: errorCode || "bad_request",
  };
  return err;
}

function sendEpicError(res, status, errorCode, errorMessage, numericErrorCode = 1001, messageVars = []) {
  return res.status(status).json({
    errorCode,
    errorMessage,
    messageVars,
    numericErrorCode,
    originatingService: "fortnite",
    intent: "prod-live",
    error_description: errorMessage,
    error: errorCode,
  });
}

module.exports = { epicError, sendEpicError };
