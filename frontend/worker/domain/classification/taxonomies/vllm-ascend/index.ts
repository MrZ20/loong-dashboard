import type { RepositoryTaxonomy } from "../../types";
import { attention } from "./attention";
import { ciInfra } from "./ci-infra";
import { compilation } from "./compilation";
import { coreScheduler } from "./core-scheduler";
import { deviceMemory } from "./device-memory";
import { distributedKvTransfer } from "./distributed-kv-transfer";
import { documentation } from "./documentation";
import { eplb } from "./eplb";
import { fusedMoeOps } from "./fused-moe-ops";
import { kvOffload } from "./kv-offload";
import { lora } from "./lora";
import { modelLoading } from "./model-loading";
import { modelsMultimodal } from "./models-multimodal";
import { other } from "./other";
import { platformPatches } from "./platform-patches";
import { quantization } from "./quantization";
import { sampling } from "./sampling";
import { speculativeDecoding } from "./speculative-decoding";
import { tests } from "./tests";
import { workerGraph } from "./worker-graph";
import { xlite } from "./xlite";

export const VLLM_ASCEND_TAXONOMY: RepositoryTaxonomy = {
  repoId: "vllm-ascend",
  name: "vLLM-Ascend",
  version: "vllm-ascend-taxonomy-2026.08.02-v1",
  evidenceRevision: "3621965817a8e73f984fe3761c0389151a500902",
  defaultDomain: "Other",
  domains: [
    attention, fusedMoeOps, workerGraph, coreScheduler, distributedKvTransfer,
    eplb, kvOffload, compilation, quantization, speculativeDecoding, sampling,
    lora, modelLoading, deviceMemory, xlite, modelsMultimodal, platformPatches,
    ciInfra, documentation, tests, other,
  ],
};
