import { Product } from '../models/types.js';
export declare class ProductRepository {
    static list({ businessId, search, activeOnly }: {
        businessId: string;
        search?: string;
        activeOnly?: boolean;
    }): Promise<Product[]>;
    static findById({ productId, businessId }: {
        productId: string;
        businessId: string;
    }): Promise<Product | null>;
    static create(data: {
        businessId: string;
        name: string;
        unit: string;
        currentPrice: number;
    }): Promise<Product>;
    static bulkCreate(businessId: string, items: {
        name: string;
        unit: string;
        current_price: number;
    }[]): Promise<Product[]>;
    static update({ productId, businessId, data }: {
        productId: string;
        businessId: string;
        data: Partial<Pick<Product, 'name' | 'unit' | 'current_price' | 'active'>>;
    }): Promise<Product | null>;
    static delete({ productId, businessId }: {
        productId: string;
        businessId: string;
    }): Promise<boolean>;
}
