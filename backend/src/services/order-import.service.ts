import { AppError } from '../middleware/errorHandler.js';
import { ProductRepository } from '../repositories/product.repo.js';
import { getBusinessAi } from './ai/business-ai.js';
import { CatalogMatcher } from './ai/catalog.matcher.js';
import { ProviderError } from './provider-http.js';
import type { OrderImportInput } from '../validators/order-import.schemas.js';

export class OrderImportService {
  static async extract(businessId: string, input: OrderImportInput) {
    let image: Buffer | undefined;
    if (input.image) {
      image = Buffer.from(input.image.data, 'base64');
      const signature = input.image.mimeType === 'image/png' ? Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) : Buffer.from([255, 216, 255]);
      if (image.length > 3 * 1024 * 1024 || image.toString('base64') !== input.image.data || !image.subarray(0, signature.length).equals(signature)) {
        throw new AppError('Choose a valid JPEG or PNG photo below 3 MB.', 400);
      }
    }
    const catalog = await ProductRepository.catalog(businessId);
    if (!catalog.length) throw new AppError('Add active products to your catalog before importing an order.', 400);
    const ai = await getBusinessAi(businessId);
    try {
      const result = image ? await ai.extractImage(image, input.image!.mimeType, catalog, input.text) : await ai.extract(input.text, catalog);
      if (!result.items.length) throw new AppError('No order items could be read. Try clearer text or another photo.', 422);
      const match = CatalogMatcher.match(result.items, catalog);
      return {
        items: [
          ...match.matchedItems.map(item => ({ productId: item.productId, quantity: item.quantity, inputProduct: item.productName, inputQuantity: item.quantity, inputUnit: item.unit })),
          ...match.reviewItems.map(item => ({ productId: '', quantity: null, inputProduct: item.product, inputQuantity: item.quantity, inputUnit: item.unit }))
        ],
        warnings: [...result.warnings, ...match.unresolvedItems.map(item => 'Check item: ' + item), ...match.ambiguousItems.map(item => 'Choose a product for ' + item.input + ': ' + item.candidates.join(', '))],
        provider: result.provider, model: result.model, wasFallback: result.wasFallback
      };
    } catch (error) {
      if (error instanceof ProviderError) throw new AppError('Order extraction failed (' + error.code + '). Check the saved AI connection and use an image-capable model for photos.', 502);
      throw error;
    }
  }
}
