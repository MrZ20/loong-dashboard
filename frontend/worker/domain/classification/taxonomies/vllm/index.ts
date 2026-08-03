import type { RepositoryTaxonomy } from "../../types";
import { attention } from "./attention";
import { ciInfra } from "./ci-infra";
import { compilationKernels } from "./compilation-kernels";
import { distributedKvTransfer } from "./distributed-kv-transfer";
import { documentation } from "./documentation";
import { engineModelRunner } from "./engine-model-runner";
import { fusedMoe } from "./fused-moe";
import { lora } from "./lora";
import { modelSupport } from "./model-support";
import { multimodal } from "./multimodal";
import { other } from "./other";
import { platformHardware } from "./platform-hardware";
import { quantization } from "./quantization";
import { rustFrontend } from "./rust-frontend";
import { samplingOutput } from "./sampling-output";
import { schedulerKvCache } from "./scheduler-kv-cache";
import { servingApi } from "./serving-api";
import { speculativeDecoding } from "./speculative-decoding";
import { tests } from "./tests";

export const VLLM_TAXONOMY: RepositoryTaxonomy = {
  repoId: "vllm",
  name: "vLLM",
  version: "vllm-taxonomy-2026.08.02-v1",
  evidenceRevision: "1f486d96a17303ce8db8e02be39545b2be338446",
  defaultDomain: "Other",
  domains: [
    attention, fusedMoe, schedulerKvCache, distributedKvTransfer,
    engineModelRunner, compilationKernels, quantization, modelSupport,
    multimodal, speculativeDecoding, lora, rustFrontend, servingApi, samplingOutput,
    platformHardware, ciInfra, documentation, tests, other,
  ],
};
