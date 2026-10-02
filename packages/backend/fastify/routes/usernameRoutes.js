// backend/fastify/routes/usernameRoutes.js
import { usernameService } from '../../shared/usernameService.js';
import { createRequireAdmin } from '../../shared/adminGuard.js';

const requireAdmin = createRequireAdmin();

/**
 * Username API Routes
 * Manages wallet address -> username mappings. Reads are public; setting a
 * username requires a signed-in wallet and only ever writes that wallet's name.
 */
export default async function usernameRoutes(fastify) {

  /**
   * GET /api/usernames/:address
   * Get username for a wallet address
   */
  fastify.get('/:address', async (request, reply) => {
    const { address } = request.params;
    
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return reply.code(400).send({ error: 'Invalid wallet address' });
    }

    const username = await usernameService.getUsernameByAddress(address);
    
    return reply.send({
      address,
      username: username || null
    });
  });

  /**
   * POST /api/usernames
   * Set the signed-in wallet's username.
   * Auth: Bearer JWT (401 without one). The wallet comes from the JWT; a body
   * `address` is optional and, if sent, must be that same wallet (403 otherwise).
   * Body: { username: string, address?: string }
   */
  fastify.post('/', async (request, reply) => {
    const wallet = request.user?.wallet_address;
    if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return reply.code(401).send({ error: 'SIGN_IN_REQUIRED' });
    }

    const { address: bodyAddress, username } = request.body || {};
    if (bodyAddress !== undefined && String(bodyAddress).toLowerCase() !== wallet.toLowerCase()) {
      return reply.code(403).send({ error: 'NOT_YOUR_WALLET' });
    }
    const address = wallet.toLowerCase();

    // Validate username
    if (!username || typeof username !== 'string') {
      return reply.code(400).send({ error: 'Username is required' });
    }

    const result = await usernameService.setUsername(address, username);

    if (!result.success) {
      const statusCode = result.error === 'USERNAME_TAKEN' ? 409 : 400;
      return reply.code(statusCode).send({ error: result.error });
    }

    return reply.send({
      success: true,
      address,
      username
    });
  });

  /**
   * GET /api/usernames/check/:username
   * Check if username is available
   */
  fastify.get('/check/:username', async (request, reply) => {
    const { username } = request.params;

    if (!username) {
      return reply.code(400).send({ error: 'Username is required' });
    }

    const validation = usernameService.validateUsername(username);
    if (!validation.valid) {
      return reply.send({
        available: false,
        error: validation.error
      });
    }

    const available = await usernameService.isUsernameAvailable(username);

    return reply.send({
      available,
      username
    });
  });

  /**
   * GET /api/usernames/batch
   * Get usernames for multiple addresses
   * Query: ?addresses=0x123,0x456,0x789
   */
  fastify.get('/batch', async (request, reply) => {
    const { addresses } = request.query;

    if (!addresses) {
      return reply.code(400).send({ error: 'Addresses query parameter is required' });
    }

    const addressArray = addresses.split(',').map(addr => addr.trim());
    
    // Validate all addresses
    const invalidAddresses = addressArray.filter(addr => !/^0x[a-fA-F0-9]{40}$/.test(addr));
    if (invalidAddresses.length > 0) {
      return reply.code(400).send({ 
        error: 'Invalid wallet addresses',
        invalid: invalidAddresses
      });
    }

    const usernamesMap = await usernameService.getBatchUsernames(addressArray);
    
    // Convert Map to object for JSON response
    const result = {};
    usernamesMap.forEach((username, address) => {
      result[address] = username;
    });

    return reply.send(result);
  });

  /**
   * GET /api/usernames/all
   * Get all username mappings (admin only)
   */
  fastify.get('/all', { preHandler: requireAdmin }, async (request, reply) => {
    const allUsernames = await usernameService.getAllUsernames();
    
    return reply.send({
      count: allUsernames.length,
      usernames: allUsernames
    });
  });
}
