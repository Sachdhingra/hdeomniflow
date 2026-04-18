import ProductCatalog from "@/components/ProductCatalog";

const ProductsView = () => {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Products</h1>
        <p className="text-sm text-muted-foreground">
          Browse the active product catalog. Search by SKU, name, or code.
        </p>
      </div>
      <ProductCatalog />
    </div>
  );
};

export default ProductsView;
