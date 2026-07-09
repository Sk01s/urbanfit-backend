const defaultShippingRates = [
  { city: "Beirut", rate: 3 },
  { city: "Tripoli", rate: 5 },
  { city: "Sidon", rate: 5 },
  { city: "Tyre", rate: 6 },
  { city: "Jounieh", rate: 4 },
  { city: "Byblos", rate: 5 },
  { city: "Baalbek", rate: 7 },
  { city: "Zahle", rate: 6 },
  { city: "Nabatieh", rate: 6 },
  { city: "Batroun", rate: 5 },
];

export default async function shippingRoutes(fastify, options) {
  const firebase = options.firebase;

  // Get all shipping rates
  fastify.get("/api/shipping/rates", async (request, reply) => {
    try {
      const doc = await firebase.db
        .collection("settings")
        .doc("shippingRates")
        .get();

      if (doc.exists) {
        return {
          success: true,
          data: doc.data(),
        };
      }

      return {
        success: true,
        data: {
          rates: defaultShippingRates,
          defaultRate: 5,
          enabled: true,
        },
      };
    } catch (error) {
      fastify.log.error("Failed to get shipping rates:", error);
      return reply.status(500).send({
        error: "Failed to get shipping rates",
        message: error.message,
      });
    }
  });

  // Get shipping rate for a specific city
  fastify.get("/api/shipping/rate/:city", async (request, reply) => {
    try {
      const { city } = request.params;
      const doc = await firebase.db
        .collection("settings")
        .doc("shippingRates")
        .get();

      let rates = defaultShippingRates;
      let defaultRate = 5;

      if (doc.exists) {
        const data = doc.data();
        rates = data.rates || defaultShippingRates;
        defaultRate = data.defaultRate || 5;
      }

      const cityLower = city.toLowerCase().trim();
      const cityRate = rates.find(
        (r) => r.city.toLowerCase().trim() === cityLower
      );

      return {
        success: true,
        city: city,
        rate: cityRate ? cityRate.rate : defaultRate,
        isDefault: !cityRate,
      };
    } catch (error) {
      fastify.log.error("Failed to get shipping rate:", error);
      return reply.status(500).send({
        error: "Failed to get shipping rate",
        message: error.message,
      });
    }
  });
}
