import jwt from "jsonwebtoken";
import process from "node:process";

// JWT_SECRET / JWT_EXPIRES_IN presence is enforced at boot by
// assertRequiredEnv() in server.js — eager throws here would just defeat
// the consolidated error message.
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN;

export class AuthService {
  static async generateToken(user) {
    const payload = {
      id: user.id,
      wallet_address: user.wallet_address,
      role: user.role || "user",
    };

    if (user.username) {
      payload.username = user.username;
    }

    if (user.sma) {
      payload.sma = user.sma;
    }

    if (user.is_admin) {
      payload.is_admin = true;
    }

    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  }

  static async verifyToken(token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      return { valid: true, user: decoded };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  static async authenticateRequest(request) {
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new Error("Missing or invalid authorization header");
    }

    const token = authHeader.substring(7);
    const result = await this.verifyToken(token);

    if (!result.valid) {
      throw new Error("Invalid or expired token");
    }

    return result.user;
  }
}

// Fastify authentication decorator
export async function authenticateFastify(app) {
  app.decorateRequest("user", null);

  app.addHook("preHandler", async (request, reply) => {
    // reply parameter required by Fastify hook interface but not used in this implementation
    if (reply) {
      // Intentionally empty - reply parameter required by Fastify hook interface
    }
    try {
      const user = await AuthService.authenticateRequest(request);
      request.user = user;
    } catch {
      // Allow unauthenticated requests for public endpoints
    }
  });
}

export default AuthService;
