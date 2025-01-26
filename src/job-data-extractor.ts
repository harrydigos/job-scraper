import { Page } from "playwright";
import { SELECTORS } from "./constants";
import { sanitizeText } from "./utils";
import { createLogger } from "./logger";

const logger = createLogger({
  level: "debug",
  transports: ["console", "file"],
});

export class JobDataExtractor {
  constructor(private page: Page) {}

  async getDescription() {
    return this.page.evaluate(
      (selector) =>
        Array.from(
          document.querySelector(selector)?.querySelectorAll("p, li") || [],
        ).map((el) => el.textContent?.trim() || ""),
      SELECTORS.jobDescription,
    );
  }

  async getTimeSincePosted() {
    return this.page.evaluate(
      (selector) => document.querySelector(selector)?.textContent || "",
      SELECTORS.timeSincePosted,
    );
  }

  async getCompanyLink() {
    return this.page.evaluate(
      (selector) =>
        document.querySelector(selector)?.getAttribute("href") || "",
      SELECTORS.companyLink,
    );
  }

  async getSkills() {
    return this.page.evaluate(
      (selector) =>
        Array.from(document.querySelectorAll(selector))
          .flatMap((el) => (el.textContent || "").split(", "))
          .map((skill) => skill.replace(/and/g, "").trim())
          .filter(Boolean),
      SELECTORS.skillsRequired,
    );
  }

  async getRequirements() {
    return this.page.evaluate(
      (selector) =>
        Array.from(document.querySelectorAll(selector))
          .map((el) => (el.textContent || "").trim())
          .filter(Boolean),
      SELECTORS.requirements,
    );
  }

  async getJobInsights() {
    return this.page.evaluate(
      (selector) =>
        Array.from(document.querySelectorAll(selector))
          .map((e) => e.textContent || "")
          .filter(Boolean),
      SELECTORS.insights,
    );
  }

  async getApplyLink() {
    try {
      const applyButton = this.page.locator(SELECTORS.applyButton).first();
      if ((await applyButton.count()) === 0) return "";

      const [newPage] = await Promise.all([
        this.page.context().waitForEvent("page", { timeout: 8000 }),
        applyButton.click(),
      ]);

      if (!newPage || newPage === this.page) return "";

      const url = new URL(newPage.url());
      url.search = "";
      await newPage.close();
      return url.toString();
    } catch (e) {
      logger.error("Failed to get apply link", e);
      return "";
    }
  }

  parseJobLocation(companyText: string) {
    const match = sanitizeText(companyText).match(
      /^(.*?)\s·\s(.*?)\s\((.*?)\)$/,
    );
    return {
      company: sanitizeText(match?.[1]),
      location: sanitizeText(match?.[2]),
      workType: sanitizeText(match?.[3]),
    };
  }

  async getJobCards(limit: number) {
    logger.debug("Extracting job cards", { limit });
    try {
      return await this.page.evaluate(
        ({ selectors, limit }) => {
          return Array.from(document.querySelectorAll(selectors.jobs))
            .slice(0, Math.min(limit, 25))
            .map((job) => ({
              id: job.getAttribute("data-job-id") || "",
              title: job.querySelector(selectors.jobTitle)?.textContent || "",
              link:
                job.querySelector<HTMLAnchorElement>(selectors.jobLink)?.href ||
                "",
              company: job.querySelector(selectors.company)?.textContent || "",
              companyImgLink:
                job.querySelector("img")?.getAttribute("src") || "",
              isPromoted: Array.from(job.querySelectorAll("li")).some(
                (item) => item.textContent?.trim() === "Promoted",
              ),
            }));
        },
        { selectors: SELECTORS, limit },
      );
    } catch (error) {
      logger.error("Failed to extract job cards", error);
      return [];
    }
  }

  async getJobDetails() {
    logger.debug("Extracting full job details");
    const results = await Promise.allSettled([
      this.getDescription(),
      this.getTimeSincePosted(),
      this.getCompanyLink(),
      this.getSkills(),
      this.getRequirements(),
      this.getJobInsights(),
      this.getApplyLink(),
    ]);

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        logger.error(
          `Failed to extract job detail at index ${index}`,
          result.reason,
        );
      }
    });

    return {
      description: results[0].status === "fulfilled" ? results[0].value : [],
      timeSincePosted:
        results[1].status === "fulfilled" ? results[1].value : "",
      companyLink: results[2].status === "fulfilled" ? results[2].value : "",
      skillsRequired: results[3].status === "fulfilled" ? results[3].value : [],
      requirements: results[4].status === "fulfilled" ? results[4].value : [],
      jobInsights: results[5].status === "fulfilled" ? results[5].value : [],
      applyLink: results[6].status === "fulfilled" ? results[6].value : "",
    };
  }
}
