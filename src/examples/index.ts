import type { FileFormat } from "../engine/file";
import retirement from "./retirement.json";
import projectEstimate from "./project-estimate.json";
import markovChain from "./markov-chain.json";
import statsPlayground from "./stats-playground.json";

export interface Example {
  name: string;
  description: string;
  data: FileFormat;
}

export const examples: Example[] = [
  {
    name: "Retirement savings",
    description: "Model nest egg growth with uncertain returns, inflation, and contributions using Chain iteration.",
    data: retirement as unknown as FileFormat,
  },
  {
    name: "Project cost estimate",
    description: "Estimate total project cost from uncertain task hours and hourly rates with contingency.",
    data: projectEstimate as unknown as FileFormat,
  },
  {
    name: "Markov chain",
    description: "Employment status model with random transitions — both as unrolled rows and as a Chain cell.",
    data: markovChain as unknown as FileFormat,
  },
  {
    name: "Stats playground",
    description: "Compare Normal, LogNormal, Uniform, Triangular, Beta, and Discrete distributions side by side.",
    data: statsPlayground as unknown as FileFormat,
  },
];
