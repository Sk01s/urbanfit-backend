import { Resend } from "resend";

class EmailService {
  constructor() {
    this.resend = null;
    this.fromEmail = null;
    this.adminEmail = null;
    this.isInitialized = false;
  }

  initialize() {
    const apiKey = process.env.RESEND_API_KEY;
    this.fromEmail = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
    this.adminEmail = process.env.ADMIN_EMAIL;

    if (!apiKey) {
      console.warn("RESEND_API_KEY not configured. Email service will be disabled.");
      return false;
    }

    this.resend = new Resend(apiKey);
    this.isInitialized = true;
    console.log("Email service initialized successfully");
    return true;
  }

  // Generate order email HTML for customer
  generateCustomerOrderEmail(order) {
    const itemsHtml = order.items
      .map(
        (item) => `
        <tr>
          <td style="padding: 16px; border-bottom: 1px solid #e5e7eb;">
            <div style="display: flex; align-items: center; gap: 16px;">
              <img src="${item.image}" alt="${item.name}" style="width: 80px; height: 80px; object-fit: cover; border-radius: 8px;" />
              <div>
                <h4 style="margin: 0; font-size: 14px; color: #111827;">${item.name}</h4>
                <p style="margin: 4px 0 0; font-size: 12px; color: #6b7280;">Size: ${this.formatSize(item.selectedSize)} | Qty: ${item.quantity}</p>
              </div>
            </div>
          </td>
          <td style="padding: 16px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 600; color: #111827;">
            $${this.calculateItemPrice(item).toFixed(2)}
          </td>
        </tr>
      `
      )
      .join("");

    const subtotal = order.items.reduce(
      (sum, item) => sum + this.calculateItemPrice(item) * item.quantity,
      0
    );
    const discount = (subtotal * (order.promo?.percentage || 0)) / 100;
    // Use shippingRate from order (set during checkout based on city), fallback to legacy 'shipping' field or default
    const shipping = order.shippingRate ?? order.shipping ?? 5;
    const total = subtotal - discount + shipping;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Order Confirmation</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #1f2937 0%, #374151 100%); border-radius: 16px 16px 0 0; padding: 40px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">Order Confirmed!</h1>
      <p style="color: #d1d5db; margin: 12px 0 0; font-size: 16px;">Thank you for your order, ${order.address?.fullname || "Customer"}</p>
    </div>
    
    <!-- Order Info -->
    <div style="background-color: #ffffff; padding: 32px; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">
      <div style="background-color: #f9fafb; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
        <div style="display: flex; justify-content: space-between; flex-wrap: wrap; gap: 16px;">
          <div>
            <p style="margin: 0; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Order Number</p>
            <p style="margin: 4px 0 0; font-size: 16px; font-weight: 600; color: #111827;">#${order.id}</p>
          </div>
          <div>
            <p style="margin: 0; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Order Date</p>
            <p style="margin: 4px 0 0; font-size: 16px; font-weight: 600; color: #111827;">${new Date(order.date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>
          </div>
          <div>
            <p style="margin: 0; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">Payment Method</p>
            <p style="margin: 4px 0 0; font-size: 16px; font-weight: 600; color: #111827;">${order.payment === "cod" ? "Cash on Delivery" : "Credit Card"}</p>
          </div>
        </div>
      </div>

      <!-- Items -->
      <h3 style="margin: 0 0 16px; font-size: 18px; color: #111827;">Order Items</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>

      <!-- Summary -->
      <div style="margin-top: 24px; padding-top: 24px; border-top: 2px solid #e5e7eb;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
          <span style="color: #6b7280;">Subtotal</span>
          <span style="color: #111827; font-weight: 500;">$${subtotal.toFixed(2)}</span>
        </div>
        ${
          discount > 0
            ? `
        <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
          <span style="color: #059669;">Discount (${order.promo.percentage}%)</span>
          <span style="color: #059669; font-weight: 500;">-$${discount.toFixed(2)}</span>
        </div>
        `
            : ""
        }
        <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
          <span style="color: #6b7280;">Shipping</span>
          <span style="color: #111827; font-weight: 500;">$${shipping.toFixed(2)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding-top: 16px; border-top: 1px solid #e5e7eb;">
          <span style="font-size: 18px; font-weight: 700; color: #111827;">Total</span>
          <span style="font-size: 18px; font-weight: 700; color: #111827;">$${total.toFixed(2)}</span>
        </div>
      </div>
    </div>

    <!-- Shipping Address -->
    <div style="background-color: #ffffff; padding: 32px; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">
      <h3 style="margin: 0 0 16px; font-size: 18px; color: #111827;">Shipping Address</h3>
      <div style="background-color: #f9fafb; border-radius: 12px; padding: 20px;">
        <p style="margin: 0; color: #111827; font-weight: 600;">${order.address?.fullname || ""}</p>
        <p style="margin: 8px 0 0; color: #6b7280; line-height: 1.6;">
          ${order.address?.street || ""}<br>
          ${order.address?.building ? `Building: ${order.address.building}` : ""}${order.address?.floor ? `, Floor: ${order.address.floor}` : ""}<br>
          ${order.address?.city || ""} ${order.address?.zipcode || ""}<br>
          ${order.address?.country || ""}
        </p>
        <p style="margin: 12px 0 0; color: #6b7280;">
          <strong>Phone:</strong> ${order.address?.mobile?.value || ""}
        </p>
      </div>
    </div>

    <!-- Footer -->
    <div style="background-color: #1f2937; border-radius: 0 0 16px 16px; padding: 32px; text-align: center;">
      <p style="margin: 0; color: #9ca3af; font-size: 14px;">
        Questions about your order? Contact us at support@urbanfitlb.com
      </p>
      <p style="margin: 16px 0 0; color: #6b7280; font-size: 12px;">
        URBANFIT - Premium Streetwear
      </p>
    </div>
  </div>
</body>
</html>
    `;
  }

  // Generate order email HTML for admin
  generateAdminOrderEmail(order) {
    const itemsHtml = order.items
      .map(
        (item) => `
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">
            <img src="${item.image}" alt="${item.name}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 4px;" />
          </td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">
            <strong>${item.name}</strong><br>
            <span style="color: #6b7280; font-size: 12px;">ID: ${item.id}</span>
          </td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${this.formatSize(item.selectedSize)}</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.quantity}</td>
          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">$${this.calculateItemPrice(item).toFixed(2)}</td>
        </tr>
      `
      )
      .join("");

    const subtotal = order.items.reduce(
      (sum, item) => sum + this.calculateItemPrice(item) * item.quantity,
      0
    );
    const discount = (subtotal * (order.promo?.percentage || 0)) / 100;
    // Use shippingRate from order (set during checkout based on city), fallback to legacy 'shipping' field or default
    const shipping = order.shippingRate ?? order.shipping ?? 5;
    const total = subtotal - discount + shipping;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Order Notification</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <div style="max-width: 700px; margin: 0 auto; padding: 40px 20px;">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); border-radius: 16px 16px 0 0; padding: 32px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700;">NEW ORDER RECEIVED</h1>
      <p style="color: #fecaca; margin: 8px 0 0; font-size: 14px;">Order #${order.id}</p>
    </div>
    
    <!-- Quick Summary -->
    <div style="background-color: #fef2f2; padding: 20px; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">
      <table style="width: 100%;">
        <tr>
          <td style="text-align: center; padding: 10px;">
            <div style="font-size: 24px; font-weight: 700; color: #dc2626;">$${total.toFixed(2)}</div>
            <div style="font-size: 12px; color: #6b7280; text-transform: uppercase;">Total</div>
          </td>
          <td style="text-align: center; padding: 10px;">
            <div style="font-size: 24px; font-weight: 700; color: #111827;">${order.items.length}</div>
            <div style="font-size: 12px; color: #6b7280; text-transform: uppercase;">Items</div>
          </td>
          <td style="text-align: center; padding: 10px;">
            <div style="font-size: 24px; font-weight: 700; color: #111827;">${order.payment === "cod" ? "COD" : "Card"}</div>
            <div style="font-size: 12px; color: #6b7280; text-transform: uppercase;">Payment</div>
          </td>
        </tr>
      </table>
    </div>

    <!-- Customer Info -->
    <div style="background-color: #ffffff; padding: 24px; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">
      <h3 style="margin: 0 0 16px; font-size: 16px; color: #111827; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px;">CUSTOMER INFORMATION</h3>
      <table style="width: 100%;">
        <tr>
          <td style="padding: 8px 0; color: #6b7280; width: 120px;">Name:</td>
          <td style="padding: 8px 0; color: #111827; font-weight: 500;">${order.address?.fullname || "N/A"}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b7280;">Email:</td>
          <td style="padding: 8px 0; color: #111827; font-weight: 500;">${order.address?.email || "N/A"}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b7280;">Phone:</td>
          <td style="padding: 8px 0; color: #111827; font-weight: 500;">${order.address?.mobile?.value || "N/A"}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b7280; vertical-align: top;">Address:</td>
          <td style="padding: 8px 0; color: #111827; font-weight: 500;">
            ${order.address?.street || ""}<br>
            ${order.address?.building ? `Building: ${order.address.building}` : ""}${order.address?.floor ? `, Floor: ${order.address.floor}` : ""}<br>
            ${order.address?.city || ""} ${order.address?.zipcode || ""}<br>
            ${order.address?.country || ""}
          </td>
        </tr>
      </table>
    </div>

    <!-- Order Items -->
    <div style="background-color: #ffffff; padding: 24px; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">
      <h3 style="margin: 0 0 16px; font-size: 16px; color: #111827; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px;">ORDER ITEMS</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="background-color: #f9fafb;">
            <th style="padding: 12px; text-align: left; font-size: 12px; color: #6b7280; text-transform: uppercase;">Image</th>
            <th style="padding: 12px; text-align: left; font-size: 12px; color: #6b7280; text-transform: uppercase;">Product</th>
            <th style="padding: 12px; text-align: center; font-size: 12px; color: #6b7280; text-transform: uppercase;">Size</th>
            <th style="padding: 12px; text-align: center; font-size: 12px; color: #6b7280; text-transform: uppercase;">Qty</th>
            <th style="padding: 12px; text-align: right; font-size: 12px; color: #6b7280; text-transform: uppercase;">Price</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>

      <!-- Order Summary -->
      <div style="margin-top: 24px; padding: 16px; background-color: #f9fafb; border-radius: 8px;">
        <table style="width: 100%;">
          <tr>
            <td style="padding: 4px 0; color: #6b7280;">Subtotal:</td>
            <td style="padding: 4px 0; text-align: right; color: #111827;">$${subtotal.toFixed(2)}</td>
          </tr>
          ${
            discount > 0
              ? `
          <tr>
            <td style="padding: 4px 0; color: #059669;">Discount (${order.promo.percentage}% - ${order.promo.code}):</td>
            <td style="padding: 4px 0; text-align: right; color: #059669;">-$${discount.toFixed(2)}</td>
          </tr>
          `
              : ""
          }
          <tr>
            <td style="padding: 4px 0; color: #6b7280;">Shipping:</td>
            <td style="padding: 4px 0; text-align: right; color: #111827;">$${shipping.toFixed(2)}</td>
          </tr>
          <tr style="border-top: 2px solid #e5e7eb;">
            <td style="padding: 12px 0 4px; font-weight: 700; font-size: 18px; color: #111827;">Total:</td>
            <td style="padding: 12px 0 4px; text-align: right; font-weight: 700; font-size: 18px; color: #dc2626;">$${total.toFixed(2)}</td>
          </tr>
        </table>
      </div>
    </div>

    <!-- Footer -->
    <div style="background-color: #1f2937; border-radius: 0 0 16px 16px; padding: 24px; text-align: center;">
      <a href="https://urbanfitlb.com/admin/orders/${order.id}" style="display: inline-block; background-color: #dc2626; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-weight: 600;">View Order in Dashboard</a>
      <p style="margin: 16px 0 0; color: #6b7280; font-size: 12px;">
        Received at ${new Date(order.date).toLocaleString()}
      </p>
    </div>
  </div>
</body>
</html>
    `;
  }

  // Generate wishlist reminder email
  generateWishlistReminderEmail(user, product) {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Wishlist Item is Waiting!</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); border-radius: 16px 16px 0 0; padding: 40px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">Still thinking about it?</h1>
      <p style="color: #ddd6fe; margin: 12px 0 0; font-size: 16px;">Your wishlist item is waiting for you!</p>
    </div>
    
    <!-- Product -->
    <div style="background-color: #ffffff; padding: 32px; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">
      <div style="text-align: center; margin-bottom: 24px;">
        <img src="${product.image}" alt="${product.name}" style="max-width: 300px; height: auto; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);" />
      </div>
      
      <h2 style="margin: 0; text-align: center; font-size: 24px; color: #111827;">${product.name}</h2>
      
      <div style="text-align: center; margin-top: 16px;">
        ${
          product.onSale
            ? `
          <span style="text-decoration: line-through; color: #9ca3af; font-size: 18px;">$${product.price}</span>
          <span style="font-size: 28px; font-weight: 700; color: #dc2626; margin-left: 8px;">$${(product.price * (1 - product.percentage / 100)).toFixed(2)}</span>
          <span style="background-color: #dc2626; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; margin-left: 8px;">${product.percentage}% OFF</span>
        `
            : `
          <span style="font-size: 28px; font-weight: 700; color: #111827;">$${product.price}</span>
        `
        }
      </div>

      <div style="text-align: center; margin-top: 32px;">
        <a href="https://urbanfitlb.com/product/${product.id}" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: #ffffff; text-decoration: none; padding: 16px 48px; border-radius: 8px; font-weight: 600; font-size: 16px;">Shop Now</a>
      </div>
    </div>

    <!-- Footer -->
    <div style="background-color: #1f2937; border-radius: 0 0 16px 16px; padding: 32px; text-align: center;">
      <p style="margin: 0; color: #9ca3af; font-size: 14px;">
        You're receiving this because you added this item to your wishlist.
      </p>
      <p style="margin: 16px 0 0; color: #6b7280; font-size: 12px;">
        URBANFIT - Premium Streetwear
      </p>
    </div>
  </div>
</body>
</html>
    `;
  }

  // Generate admin OTP email
  generateAdminOtpEmail(adminName, otpCode) {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Verification Code</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <div style="max-width: 500px; margin: 0 auto; padding: 40px 20px;">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); border-radius: 16px 16px 0 0; padding: 40px; text-align: center;">
      <div style="width: 60px; height: 60px; background-color: #3b82f6; border-radius: 12px; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center;">
        <span style="font-size: 30px;">🔐</span>
      </div>
      <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700;">Admin Verification</h1>
      <p style="color: #94a3b8; margin: 8px 0 0; font-size: 14px;">Secure access to your dashboard</p>
    </div>
    
    <!-- Content -->
    <div style="background-color: #ffffff; padding: 40px; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb; text-align: center;">
      <p style="color: #6b7280; margin: 0 0 24px; font-size: 16px;">
        Hello ${adminName || "Admin"},<br>
        Use the verification code below to access the admin dashboard:
      </p>
      
      <div style="background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); border: 2px dashed #3b82f6; border-radius: 12px; padding: 24px; margin: 24px 0;">
        <div style="font-size: 40px; font-weight: 700; letter-spacing: 8px; color: #1e40af; font-family: monospace;">${otpCode}</div>
      </div>
      
      <div style="background-color: #fef3c7; border-radius: 8px; padding: 16px; margin-top: 24px;">
        <p style="margin: 0; color: #92400e; font-size: 14px;">
          <strong>This code expires in 20 minutes.</strong><br>
          Do not share this code with anyone.
        </p>
      </div>
    </div>

    <!-- Security Notice -->
    <div style="background-color: #f9fafb; padding: 24px; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">
      <p style="margin: 0; color: #6b7280; font-size: 12px; text-align: center;">
        If you didn't request this code, please ignore this email or contact support if you have concerns about your account security.
      </p>
    </div>

    <!-- Footer -->
    <div style="background-color: #1f2937; border-radius: 0 0 16px 16px; padding: 24px; text-align: center;">
      <p style="margin: 0; color: #6b7280; font-size: 12px;">
        URBANFIT Admin Security
      </p>
    </div>
  </div>
</body>
</html>
    `;
  }

  // Helper functions
  formatSize(size) {
    const sizeMap = {
      xs: "XS",
      sm: "S",
      md: "M",
      lg: "L",
      xl: "XL",
    };
    return sizeMap[size?.toLowerCase()] || size?.toUpperCase() || "N/A";
  }

  calculateItemPrice(item) {
    if (item.onSale && item.percentage) {
      return Number(item.price) * (1 - Number(item.percentage / 100));
    }
    return Number(item.price);
  }

  // Send order confirmation email to customer
  async sendOrderConfirmationToCustomer(order) {
    if (!this.isInitialized) {
      console.warn("Email service not initialized. Skipping customer email.");
      return { success: false, error: "Email service not initialized" };
    }

    try {
      const html = this.generateCustomerOrderEmail(order);
      const result = await this.resend.emails.send({
        from: this.fromEmail,
        to: order.address?.email,
        subject: `Order Confirmed - #${order.id}`,
        html,
      });

      console.log(`Customer order email sent: ${order.address?.email}`);
      return { success: true, data: result };
    } catch (error) {
      console.error("Failed to send customer order email:", error);
      return { success: false, error: error.message };
    }
  }

  // Send order notification email to admin
  async sendOrderNotificationToAdmin(order) {
    if (!this.isInitialized) {
      console.warn("Email service not initialized. Skipping admin email.");
      return { success: false, error: "Email service not initialized" };
    }

    if (!this.adminEmail) {
      console.warn("Admin email not configured. Skipping admin notification.");
      return { success: false, error: "Admin email not configured" };
    }

    try {
      const html = this.generateAdminOrderEmail(order);
      const result = await this.resend.emails.send({
        from: this.fromEmail,
        to: this.adminEmail,
        subject: `[NEW ORDER] #${order.id} - $${this.calculateOrderTotal(order).toFixed(2)}`,
        html,
      });

      console.log(`Admin order notification sent: ${this.adminEmail}`);
      return { success: true, data: result };
    } catch (error) {
      console.error("Failed to send admin order email:", error);
      return { success: false, error: error.message };
    }
  }

  // Send wishlist reminder email
  async sendWishlistReminder(userEmail, userName, product) {
    if (!this.isInitialized) {
      console.warn("Email service not initialized. Skipping wishlist email.");
      return { success: false, error: "Email service not initialized" };
    }

    try {
      const html = this.generateWishlistReminderEmail({ name: userName, email: userEmail }, product);
      const result = await this.resend.emails.send({
        from: this.fromEmail,
        to: userEmail,
        subject: `Still thinking about ${product.name}?`,
        html,
      });

      console.log(`Wishlist reminder sent: ${userEmail}`);
      return { success: true, data: result };
    } catch (error) {
      console.error("Failed to send wishlist reminder:", error);
      return { success: false, error: error.message };
    }
  }

  // Send admin OTP email
  async sendAdminOtp(adminEmail, adminName, otpCode) {
    if (!this.isInitialized) {
      console.warn("Email service not initialized. Skipping OTP email.");
      return { success: false, error: "Email service not initialized" };
    }

    try {
      const html = this.generateAdminOtpEmail(adminName, otpCode);
      const result = await this.resend.emails.send({
        from: this.fromEmail,
        to: adminEmail,
        subject: `Your Admin Verification Code: ${otpCode}`,
        html,
      });

      console.log(`Admin OTP sent: ${adminEmail}`);
      return { success: true, data: result };
    } catch (error) {
      console.error("Failed to send admin OTP:", error);
      return { success: false, error: error.message };
    }
  }

  // Calculate order total
  calculateOrderTotal(order) {
    const subtotal = order.items.reduce(
      (sum, item) => sum + this.calculateItemPrice(item) * item.quantity,
      0
    );
    const discount = (subtotal * (order.promo?.percentage || 0)) / 100;
    // Use shippingRate from order (set during checkout based on city), fallback to legacy 'shipping' field or default
    const shipping = order.shippingRate ?? order.shipping ?? 5;
    return subtotal - discount + shipping;
  }
}

export default new EmailService();
