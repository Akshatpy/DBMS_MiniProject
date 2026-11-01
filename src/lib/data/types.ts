export interface ProductCard {
  product_id: number;
  title: string;
  brand: string | null;
  price: number;
  mrp: number;
  discount_pct: number;
  image_url: string | null;
  avg_rating: number;
  review_count: number;
  stock_qty: number;
  stock_status: 'in_stock' | 'low_stock' | 'out_of_stock';
  category_id: number;
  category_name: string;
  top_category_name: string;
  seller_id: number;
  store_name: string;
}

export type SearchMode = 'lexical' | 'semantic' | 'hybrid';

export interface SearchHit extends ProductCard {
  score: number;
  lexical_rank: number | null;
  semantic_rank: number | null;
  review_rank: number | null;
  semantic_similarity: number | null;
  matched_review_id: number | null;
  matched_review_similarity: number | null;
  matched_review_body: string | null;
  matched_review_rating: number | null;
}

export interface SearchParams {
  q: string;
  mode: SearchMode;
  categoryId?: number | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  minRating?: number | null;
  inStock?: boolean;
  limit?: number;
}
