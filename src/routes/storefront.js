export default async function storefrontRoutes(fastify, options) {
  const firebase = options.firebase;

  // Get all products
  fastify.get("/api/storefront/products", async (request, reply) => {
    try {
      const snapshot = await firebase.db.collection("products").get();
      const products = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      return { success: true, data: products };
    } catch (error) {
      fastify.log.error("Failed to get products:", error);
      return reply.status(500).send({
        error: "Failed to get products",
        message: error.message,
      });
    }
  });

  // Get single product
  fastify.get("/api/storefront/products/:id", async (request, reply) => {
    try {
      const { id } = request.params;
      const doc = await firebase.db.collection("products").doc(id).get();

      if (!doc.exists) {
        return reply.status(404).send({ error: "Product not found" });
      }

      return { success: true, data: { id: doc.id, ...doc.data() } };
    } catch (error) {
      fastify.log.error("Failed to get product:", error);
      return reply.status(500).send({
        error: "Failed to get product",
        message: error.message,
      });
    }
  });

  // Get V2 products
  fastify.get("/api/storefront/products-v2", async (request, reply) => {
    try {
      const snapshot = await firebase.db.collection("products_v2").get();
      const products = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      return { success: true, data: products };
    } catch (error) {
      fastify.log.error("Failed to get V2 products:", error);
      return reply.status(500).send({
        error: "Failed to get products",
        message: error.message,
      });
    }
  });

  // Get single V2 product
  fastify.get("/api/storefront/products-v2/:id", async (request, reply) => {
    try {
      const { id } = request.params;
      const doc = await firebase.db.collection("products_v2").doc(id).get();

      if (!doc.exists) {
        return reply.status(404).send({ error: "Product not found" });
      }

      return { success: true, data: { id: doc.id, ...doc.data() } };
    } catch (error) {
      fastify.log.error("Failed to get V2 product:", error);
      return reply.status(500).send({
        error: "Failed to get product",
        message: error.message,
      });
    }
  });

  // Get categories
  fastify.get("/api/storefront/categories", async (request, reply) => {
    try {
      const snapshot = await firebase.db.collection("categories").get();
      const categories = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      return { success: true, data: categories };
    } catch (error) {
      fastify.log.error("Failed to get categories:", error);
      return reply.status(500).send({
        error: "Failed to get categories",
        message: error.message,
      });
    }
  });

  // Search products
  fastify.get("/api/storefront/search", async (request, reply) => {
    try {
      const { q } = request.query;
      if (!q || q.trim().length === 0) {
        return reply.status(400).send({ error: "Search query is required" });
      }

      const searchTerm = q.toLowerCase().trim();
      const snapshot = await firebase.db.collection("products").get();
      const products = snapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter(
          (p) =>
            p.name?.toLowerCase().includes(searchTerm) ||
            p.description?.toLowerCase().includes(searchTerm) ||
            p.brand?.toLowerCase().includes(searchTerm)
        );

      return { success: true, data: products, query: searchTerm };
    } catch (error) {
      fastify.log.error("Failed to search products:", error);
      return reply.status(500).send({
        error: "Failed to search products",
        message: error.message,
      });
    }
  });

  // Get site images
  fastify.get("/api/storefront/site-images", async (request, reply) => {
    try {
      const doc = await firebase.db.collection("settings").doc("siteImages").get();
      return {
        success: true,
        data: doc.exists ? doc.data() : {},
      };
    } catch (error) {
      fastify.log.error("Failed to get site images:", error);
      return reply.status(500).send({
        error: "Failed to get site images",
        message: error.message,
      });
    }
  });

  // Get landing slides
  fastify.get("/api/storefront/landing-slides", async (request, reply) => {
    try {
      const snapshot = await firebase.db.collection("landingSlides").get();
      const slides = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      return { success: true, data: slides };
    } catch (error) {
      fastify.log.error("Failed to get landing slides:", error);
      return reply.status(500).send({
        error: "Failed to get landing slides",
        message: error.message,
      });
    }
  });

  // Get site texts
  fastify.get("/api/storefront/site-texts", async (request, reply) => {
    try {
      const doc = await firebase.db.collection("settings").doc("siteTexts").get();
      return {
        success: true,
        data: doc.exists ? doc.data() : {},
      };
    } catch (error) {
      fastify.log.error("Failed to get site texts:", error);
      return reply.status(500).send({
        error: "Failed to get site texts",
        message: error.message,
      });
    }
  });

  // Get special pages
  fastify.get("/api/storefront/special-pages", async (request, reply) => {
    try {
      const snapshot = await firebase.db.collection("specialPages").get();
      const pages = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      return { success: true, data: pages };
    } catch (error) {
      fastify.log.error("Failed to get special pages:", error);
      return reply.status(500).send({
        error: "Failed to get special pages",
        message: error.message,
      });
    }
  });

  // Get single special page
  fastify.get("/api/storefront/special-pages/:id", async (request, reply) => {
    try {
      const { id } = request.params;
      const doc = await firebase.db.collection("specialPages").doc(id).get();

      if (!doc.exists) {
        return reply.status(404).send({ error: "Special page not found" });
      }

      return { success: true, data: { id: doc.id, ...doc.data() } };
    } catch (error) {
      fastify.log.error("Failed to get special page:", error);
      return reply.status(500).send({
        error: "Failed to get special page",
        message: error.message,
      });
    }
  });

  // Get promo codes
  fastify.get("/api/storefront/promos", async (request, reply) => {
    try {
      const snapshot = await firebase.db.collection("promo").get();
      const promos = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      return { success: true, data: promos };
    } catch (error) {
      fastify.log.error("Failed to get promos:", error);
      return reply.status(500).send({
        error: "Failed to get promos",
        message: error.message,
      });
    }
  });
}
