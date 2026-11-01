# Schema Reference: views, functions, procedures, triggers

_Generated 2026-10-27._

## Views and materialized views

| Name | Kind |
|---|---|
| v_category_tree | VIEW |
| v_low_stock | VIEW |
| v_product_cards | VIEW |
| v_public_reviews | VIEW |
| v_sales_lines | VIEW |
| mv_daily_sales | MATERIALIZED VIEW |
| mv_product_pairs | MATERIALIZED VIEW |

## Functions and procedures

| Name | Kind | Arguments | Returns | Security | Language |
|---|---|---|---|---|---|
| refresh_analytics | PROCEDURE |  |  | DEFINER | plpgsql |
| restock_product | PROCEDURE | IN p_product_id bigint, IN p_quantity integer |  | invoker | plpgsql |
| admin_category_rollup | FUNCTION | p_since date | TABLE(top_category text, sub_category text, revenue numeric, units bigint, level text, share_pct numeric) | DEFINER | plpgsql |
| admin_monthly_revenue | FUNCTION |  | TABLE(month date, revenue numeric, orders bigint, units bigint, mom_growth_pct numeric, moving_avg_3m numeric, cumulative_revenue numeric) | DEFINER | plpgsql |
| admin_top_sellers | FUNCTION | p_months integer | TABLE(seller_id bigint, store_name text, main_category text, revenue numeric, units bigint, overall_rank bigint, category_rank bigint, revenue_share_pct numeric) | DEFINER | plpgsql |
| app_role | FUNCTION |  | user_role | DEFINER | sql |
| app_user_id | FUNCTION |  | bigint | invoker | sql |
| assert_admin | FUNCTION |  | void | invoker | plpgsql |
| assert_password_strength | FUNCTION | p_password text | void | invoker | plpgsql |
| authenticate | FUNCTION | p_email text, p_password text | TABLE(user_id bigint, full_name text, role user_role) | DEFINER | sql |
| cancel_order | FUNCTION | p_order_id bigint | void | DEFINER | plpgsql |
| category_descendants | FUNCTION | p_category_id integer | SETOF integer | invoker | sql |
| category_path | FUNCTION | p_category_id integer | text | invoker | sql |
| checkout | FUNCTION | p_address_id bigint, p_method payment_method | bigint | DEFINER | plpgsql |
| demo_reset_lab_product | FUNCTION |  | bigint | DEFINER | plpgsql |
| demo_unsafe_purchase | FUNCTION | p_product_id bigint, p_hold_seconds numeric | text | DEFINER | plpgsql |
| frequently_bought_together | FUNCTION | p_product_id bigint, p_limit integer | TABLE(product_id bigint, together_count integer, support numeric, confidence numeric, lift numeric) | invoker | sql |
| is_admin | FUNCTION |  | boolean | invoker | sql |
| my_cart_id | FUNCTION |  | bigint | DEFINER | sql |
| my_order_ids | FUNCTION |  | SETOF bigint | DEFINER | sql |
| my_seller_order_ids | FUNCTION |  | SETOF bigint | DEFINER | sql |
| product_embedding_text | FUNCTION | p_product_id bigint | text | invoker | sql |
| recommend_for_me | FUNCTION | p_limit integer | TABLE(product_id bigint, similarity double precision) | DEFINER | sql |
| recompute_product_ratings | FUNCTION | p_product_ids bigint[] | void | invoker | sql |
| refresh_all_taste_profiles | FUNCTION |  | integer | DEFINER | sql |
| refresh_taste_profile | FUNCTION | p_user_id bigint | void | DEFINER | sql |
| register_customer | FUNCTION | p_email text, p_password text, p_full_name text, p_phone text | bigint | DEFINER | plpgsql |
| register_seller | FUNCTION | p_email text, p_password text, p_full_name text, p_store_name text, p_gstin text, p_phone text | bigint | DEFINER | plpgsql |
| review_embedding_text | FUNCTION | p_review_id bigint | text | invoker | sql |
| search_products | FUNCTION | p_query text, p_embedding vector, p_mode search_mode, p_limit integer, p_category_id integer, p_min_price numeric, p_max_price numeric, p_min_rating numeric, p_in_stock boolean | TABLE(product_id bigint, score double precision, lexical_rank integer, semantic_rank integer, review_rank integer, semantic_similarity double precision, matched_review_id bigint, matched_review_similarity double precision) | invoker | sql |
| similar_products | FUNCTION | p_product_id bigint, p_limit integer | TABLE(product_id bigint, similarity double precision) | invoker | sql |
| trending_products | FUNCTION | p_days integer, p_limit integer | TABLE(product_id bigint, units bigint) | DEFINER | sql |

## Triggers

| Table | Trigger | Definition |
|---|---|---|
| cart_items | trg_cart_items_validate | `BEFORE INSERT OR UPDATE OF quantity ON public.cart_items FOR EACH ROW EXECUTE FUNCTION trg_fn_cart_item_validate()` |
| orders | trg_orders_status_guard | `BEFORE UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION trg_fn_order_status_guard()` |
| orders | trg_orders_status_history | `AFTER INSERT OR UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION trg_fn_order_status_history()` |
| orders | trg_orders_touch | `BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION trg_fn_touch_updated_at()` |
| products | trg_products_enqueue_embedding_ins | `AFTER INSERT ON public.products FOR EACH ROW EXECUTE FUNCTION trg_fn_enqueue_embedding('product')` |
| products | trg_products_enqueue_embedding_upd | `AFTER UPDATE OF title, brand, description, features, category_id ON public.products FOR EACH ROW WHEN (((old.title IS DISTINCT FROM new.title) OR (old.brand IS DISTINCT FROM new.brand) OR (old.description IS DISTINCT FROM new.description) OR (old.features IS DISTINCT FROM new.features) OR (old.category_id IS DISTINCT FROM new.category_id))) EXECUTE FUNCTION trg_fn_enqueue_embedding('product')` |
| products | trg_products_stock_alert | `AFTER INSERT OR UPDATE OF stock_qty, reorder_threshold ON public.products FOR EACH ROW EXECUTE FUNCTION trg_fn_stock_alert()` |
| products | trg_products_touch | `BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION trg_fn_touch_updated_at()` |
| reviews | trg_reviews_enqueue_embedding_ins | `AFTER INSERT ON public.reviews FOR EACH ROW EXECUTE FUNCTION trg_fn_enqueue_embedding('review')` |
| reviews | trg_reviews_enqueue_embedding_upd | `AFTER UPDATE OF title, body ON public.reviews FOR EACH ROW WHEN (((old.title IS DISTINCT FROM new.title) OR (old.body IS DISTINCT FROM new.body))) EXECUTE FUNCTION trg_fn_enqueue_embedding('review')` |
| reviews | trg_reviews_stats_del | `AFTER DELETE ON public.reviews REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_review_stats_del()` |
| reviews | trg_reviews_stats_ins | `AFTER INSERT ON public.reviews REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_review_stats_ins()` |
| reviews | trg_reviews_stats_upd | `AFTER UPDATE ON public.reviews REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION trg_fn_review_stats_upd()` |
| reviews | trg_reviews_verify | `BEFORE INSERT ON public.reviews FOR EACH ROW EXECUTE FUNCTION trg_fn_review_verify()` |
| users | trg_users_normalise | `BEFORE INSERT OR UPDATE OF email, full_name ON public.users FOR EACH ROW EXECUTE FUNCTION trg_fn_users_normalise()` |
