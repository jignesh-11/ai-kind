import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  
  const productId = formData.get("productId");
  const newDescription = formData.get("newDescription");

  const response = await admin.graphql(
    `#graphql
    mutation updateProduct($input: ProductInput!) {
      productUpdate(input: $input) {
        product {
          id
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        input: {
          id: productId,
          descriptionHtml: newDescription
        }
      }
    }
  );
  
  const responseJson = await response.json();
  if (responseJson.data.productUpdate.userErrors.length > 0) {
    return json({ error: responseJson.data.productUpdate.userErrors[0].message }, { status: 400 });
  }
  
  return json({ success: true, productId });
};
