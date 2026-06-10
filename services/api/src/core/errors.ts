/** Application error with a stable machine code; rendered as {error:{code,message}}. */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthorized = (msg = "authentication required") =>
  new AppError("UNAUTHORIZED", msg, 401);
export const forbidden = (msg = "forbidden") => new AppError("FORBIDDEN", msg, 403);
export const notFound = (msg = "not found") => new AppError("NOT_FOUND", msg, 404);
export const conflict = (code: string, msg: string) => new AppError(code, msg, 409);
export const badRequest = (code: string, msg: string) => new AppError(code, msg, 400);
export const notImplemented = (msg: string) => new AppError("NOT_IMPLEMENTED", msg, 501);
export const insufficientFunds = (msg = "insufficient unlocked balance") =>
  new AppError("INSUFFICIENT_FUNDS", msg, 400);
