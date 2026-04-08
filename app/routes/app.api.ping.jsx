import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";



export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return json({ 
     status: "ok", 
     shop: session.shop, 
     timestamp: new Date().toISOString() 
  });
};
