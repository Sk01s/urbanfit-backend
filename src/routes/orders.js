async function verifyAuthToken(request, firebase) {
  const authHeader = request.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw { statusCode: 401, error: "Unauthorized", message: "Missing or invalid authorization header" };
  }
  const idToken = authHeader.split("Bearer ")[1];
  try {
    const decodedToken = await firebase.auth.verifyIdToken(idToken);
    return decodedToken;
  } catch (err) {
    throw { statusCode: 401, error: "Unauthorized", message: "Invalid or expired token" };
  }
}

export default async function ordersRoutes(fastify, options) {
  const firebase = options.firebase;

  // Create V2 order with atomic stock deduction
  fastify.post("/api/orders/v2", async (request, reply) => {
    try {
      const decodedToken = await verifyAuthToken(request, firebase);
      const uid = decodedToken.uid;
      const order = request.body;

      if (!order || !order.id || !Array.isArray(order.items) || order.items.length === 0) {
        return reply.status(400).send({
          error: "Invalid order data",
          message: "Order must include id and non-empty items array",
        });
      }

      if (order.uid && order.uid !== uid) {
        return reply.status(403).send({
          error: "Forbidden",
          message: "User ID does not match authenticated user",
        });
      }

      if (order.isTestOrder) {
        const orderData = {
          ...order,
          uid,
          otp: false,
          date: order.date ? new Date(order.date) : new Date(),
        };
        const orderRef = firebase.db.collection("test_orders_v2").doc(String(order.id));
        await orderRef.set(orderData);
        return { success: true, order: orderData };
      }

      const result = await firebase.db.runTransaction(async (transaction) => {
        const productDocs = {};
        const productDataMap = {};
        let promoDoc = null;

        for (const item of order.items) {
          if (!productDocs[item.id]) {
            const docRef = firebase.db.collection("products_v2").doc(item.id);
            const doc = await transaction.get(docRef);
            if (!doc.exists) {
              throw { isClientError: true, statusCode: 404, message: `Product ${item.id} not found` };
            }
            productDocs[item.id] = docRef;
            productDataMap[item.id] = { id: doc.id, ...doc.data() };
          }
        }

        if (order.promo && order.promo.code) {
          const promoRef = firebase.db.collection("promo").doc(order.promo.code);
          promoDoc = await transaction.get(promoRef);
        }

        const enrichedItems = order.items.map((item) => {
          const product = productDataMap[item.id];
          return { ...item, ...product };
        });

        for (const item of order.items) {
          const product = productDataMap[item.id];
          if (!product || !product.colors) continue;

          const colorIndex = product.colors.findIndex(
            (c) => c.color === item.selectedColor
          );
          if (colorIndex === -1) {
            throw { isClientError: true, statusCode: 400, message: `Color ${item.selectedColor} not found in product ${item.id}` };
          }

          const variant = product.colors[colorIndex];
          const sizeKey = item.selectedSize;

          if (!variant.quantities) continue;

          const currentStock = variant.quantities[sizeKey] || 0;
          if (currentStock < item.quantity) {
            throw { isClientError: true, statusCode: 409, message: "Product is out of stock", item: { id: item.id, name: item.name, selectedColor: item.selectedColor, selectedSize: item.selectedSize, requestedQuantity: item.quantity, availableStock: currentStock } };
          }

          variant.quantities[sizeKey] = currentStock - item.quantity;

          product.totalQuantity = product.colors.reduce(
            (sum, c) =>
              sum + Object.values(c.quantities || {}).reduce((a, b) => a + b, 0),
            0
          );
        }

        const orderData = {
          ...order,
          uid,
          otp: false,
          items: enrichedItems,
          date: order.date ? new Date(order.date) : new Date(),
        };

        if (promoDoc && promoDoc.exists) {
          const currentUses = promoDoc.data().uses || 0;
          orderData.promo = { ...order.promo, uses: currentUses + 1 };
        }

        for (const [productId, product] of Object.entries(productDataMap)) {
          const docRef = productDocs[productId];
          transaction.set(docRef, product);
        }

        const orderRef = firebase.db.collection("orders_v2").doc(String(order.id));
        transaction.set(orderRef, orderData);

        if (promoDoc && promoDoc.exists) {
          const promoRef = firebase.db.collection("promo").doc(order.promo.code);
          const currentUses = promoDoc.data().uses || 0;
          transaction.update(promoRef, { uses: currentUses + 1 });
        }

        return orderData;
      });

      return { success: true, order: result };
    } catch (error) {
      if (error.isClientError) {
        return reply.status(error.statusCode).send({
          error: error.message,
          item: error.item,
        });
      }
      if (error.statusCode === 401) {
        return reply.status(401).send({ error: error.error, message: error.message });
      }
      fastify.log.error("Failed to create V2 order:", error);
      return reply.status(500).send({
        error: "Failed to create order",
        message: error.message,
      });
    }
  });

  // Delete V2 order and restore stock atomically
  fastify.delete("/api/orders/v2/:id", async (request, reply) => {
    try {
      await verifyAuthToken(request, firebase);

      const { id } = request.params;
      const { items } = request.body || {};

      if (!id) {
        return reply.status(400).send({ error: "Order ID is required" });
      }

      if (!Array.isArray(items) || items.length === 0) {
        return reply.status(400).send({ error: "Order items array is required to restore stock" });
      }

      await firebase.db.runTransaction(async (transaction) => {
        const orderRef = firebase.db.collection("orders_v2").doc(String(id));
        const orderDoc = await transaction.get(orderRef);

        if (!orderDoc.exists) {
          throw { isClientError: true, statusCode: 404, message: "Order not found" };
        }

        const productDocs = {};
        const productDataMap = {};

        for (const item of items) {
          if (!productDocs[item.id]) {
            const docRef = firebase.db.collection("products_v2").doc(item.id);
            const doc = await transaction.get(docRef);
            if (!doc.exists) continue;

            productDocs[item.id] = docRef;
            productDataMap[item.id] = { id: doc.id, ...doc.data() };
          }
        }

        for (const item of items) {
          const product = productDataMap[item.id];
          if (!product || !product.colors) continue;

          const colorIndex = product.colors.findIndex(
            (c) => c.color === item.selectedColor
          );
          if (colorIndex === -1) continue;

          const variant = product.colors[colorIndex];
          const sizeKey = item.selectedSize;

          if (variant.quantities && variant.quantities[sizeKey] !== undefined) {
            variant.quantities[sizeKey] += item.quantity;
          }

          product.totalQuantity = product.colors.reduce(
            (sum, c) =>
              sum + Object.values(c.quantities || {}).reduce((a, b) => a + b, 0),
            0
          );
        }

        for (const [productId, product] of Object.entries(productDataMap)) {
          const docRef = productDocs[productId];
          transaction.set(docRef, product);
        }

        transaction.delete(orderRef);
      });

      return { success: true, message: "Order deleted and stock restored" };
    } catch (error) {
      if (error.isClientError) {
        return reply.status(error.statusCode).send({ error: error.message });
      }
      fastify.log.error("Failed to delete V2 order:", error);
      return reply.status(500).send({
        error: "Failed to delete order",
        message: error.message,
      });
    }
  });
}
