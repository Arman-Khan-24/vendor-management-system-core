import { Business } from '../models/types.js';
export declare class BusinessRepository {
    static findById(id: string): Promise<Business | null>;
    static findBySlug(slug: string): Promise<Business | null>;
    static create(data: {
        name: string;
        slug: string;
        categoryTemplate?: string;
        phone?: string;
        currency?: string;
        invoiceTrigger?: 'Packed' | 'Delivered';
    }): Promise<Business>;
    static update(id: string, data: Partial<Pick<Business, 'name' | 'phone' | 'currency' | 'logo_url' | 'invoice_trigger'>>): Promise<Business | null>;
    static getCategoryTemplate(templateId: string): Promise<any>;
    static listCategoryTemplates(): Promise<any[]>;
}
