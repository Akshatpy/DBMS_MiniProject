/** @type {import('next').NextConfig} */
const nextConfig = {
  // native ONNX runtime must stay a server-side external, not be bundled
  serverExternalPackages: ['@huggingface/transformers', 'onnxruntime-node', 'pg'],
  images: { unoptimized: true },
};
export default nextConfig;
