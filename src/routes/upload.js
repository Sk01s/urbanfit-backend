import backblazeB2 from "../services/backblazeB2.js";

export default async function uploadRoutes(fastify, options) {
  const firebase = options.firebase;

  // Image upload endpoint
  fastify.post("/api/upload", async (request, reply) => {
    try {
      const data = await request.file();

      if (!data) {
        return reply.status(400).send({ error: "No file uploaded" });
      }

      const { filename, mimetype } = data;

      let buffer;
      if (data.file && typeof data.file.toBuffer === 'function') {
        buffer = await data.file.toBuffer();
      } else if (data.file && typeof data.file.read === 'function') {
        const chunks = [];
        for await (const chunk of data.file) {
          chunks.push(chunk);
        }
        buffer = Buffer.concat(chunks);
      } else {
        return reply.status(400).send({ error: "Unable to read file" });
      }

      const useBackblazeB2 = process.env.USE_BACKBLAZE_B2_FOR_NEW_UPLOADS === "true";
      let uploadResult;

      if (useBackblazeB2) {
        uploadResult = await backblazeB2.uploadFile(buffer, filename, mimetype);
      } else {
        const fileRef = firebase.storage
          .ref("uploads")
          .child(`${Date.now()}-${filename}`);
        const snapshot = await fileRef.put(buffer, { contentType: mimetype });
        const url = await snapshot.ref.getDownloadURL();

        uploadResult = {
          url: url,
          fileName: filename,
          service: "firebase",
        };
      }

      return {
        success: true,
        url: uploadResult.url,
        fileName: uploadResult.fileName,
        service: useBackblazeB2 ? "backblaze" : "firebase",
        uploadedAt: new Date().toISOString(),
      };
    } catch (error) {
      fastify.log.error("Upload failed:", error);
      return reply.status(500).send({
        error: "Upload failed",
        message: error.message,
      });
    }
  });

  // Delete image endpoint
  fastify.post("/api/upload/delete", async (request, reply) => {
    try {
      const { fileName, service } = request.body;

      if (!fileName) {
        return reply.status(400).send({ error: "File name is required" });
      }

      const useBackblazeB2 =
        process.env.USE_BACKBLAZE_B2_FOR_NEW_UPLOADS === "true" ||
        service === "backblaze";

      if (useBackblazeB2) {
        console.log(`Would delete from B2: ${fileName}`);
        return {
          success: true,
          message: "File reference removed (B2 cleanup would require fileId)",
        };
      } else {
        try {
          await firebase.storage.ref("site-images").child(fileName).delete();
        } catch (e) {
          console.error("Failed to delete from Firebase Storage:", e);
        }
        return { success: true };
      }
    } catch (error) {
      fastify.log.error("Delete failed:", error);
      return reply.status(500).send({
        error: "Delete failed",
        message: error.message,
      });
    }
  });
}
