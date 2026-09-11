import { showNotificationSuccess, showServerErrorNotification } from "./util";
import { Graph, SBOL2GraphView } from "sbolgraph";

export async function bootAPIserver() {
  try {
    var response = await fetch(`${import.meta.env.VITE_API_LOCATION}/api/boot`);
  } catch (err) {
    console.error(err);
    return;
  }

  if (response.status == 200) {
    console.log(response);
  }
}

export async function fetchConvertGenbankToSBOL2(genbankContent) {
  const TYPE_ERROR = 11;
  let response;
  let result;
  let count;
  for (count = 4; count < 10; count++) {
    try {
      response = await fetchWithTimeout(
        `${import.meta.env.VITE_API_LOCATION}/api/convert/genbanktosbol2`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            GenBankContent: genbankContent,
          }),
          timeout: count * 1000,
        }
      );
      break;
    } catch (err) {
      console.error(err);
      count = TYPE_ERROR - 1;
    }
  }
  if (count == 10) {
    return { sbol2_content: "", err: "Network Error" };
  } else if (count == TYPE_ERROR) {
    return { sbol2_content: "", err: TypeError };
  }

  // Parse
  try {
    result = await response.json();
  } catch (err) {
    console.error("Couldn't parse JSON.");
    showServerErrorNotification();
    return { sbol2_content: "", err: "Parse Error" };
  }

  return { sbol2_content: result.sbol2_content, err: result.err };
}

export async function fetchSBOL(url) {
  try {
    return await (await fetch(url)).text();
  } catch (err) {
    console.error(
      `Failed to fetch SBOL content from ${url}. Running in standalone mode.`
    );
    showNotification({
      title: "Failed to load SBOL from URL",
      color: "red",
    });
  }
}

// The server identifies a caller by (SynBioHub instance, username) resolved from
// the session token, so every library call has to carry both. Without the
// instance the same username on two different SynBioHub deployments would
// collide into one cache partition.
//
// The one place the frontend reads the SynBioHub session. When SeqImprove runs
// inside SynBioSuite and shares its token, only this (and the store's login())
// needs to learn where the token comes from.
export function synBioHubCredentials() {
  return {
    sessionToken: sessionStorage.getItem("SynBioHubSessionToken") || null,
    synBioHubUrlPrefix: sessionStorage.getItem("synBioHubUrlPrefix") || null,
  };
}

// quiet: skip the generic error notification, for callers that show their own.
export async function importLibrary(synBioHubSessionToken, requestURL, { quiet = false } = {}) {
    try {
        var response = await fetchWithTimeout(`${import.meta.env.VITE_API_LOCATION}/api/importUserLibrary`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                ...synBioHubCredentials(),
                sessionToken: synBioHubSessionToken,
                url: requestURL
            }),
            timeout: 300000,
        });

        // A gateway error page is not JSON; don't let that masquerade as
        // "couldn't reach the server" in the catch below.
        var result = await response.json().catch(() => ({}));

        if (!response.ok || result.error) {
            console.error("Library import failed:", result.error || response.statusText);
            if (!quiet) showServerErrorNotification();
            // The server says why (SynBioHub's HTTP status, "no parts in it",
            // an SBOL parse error); pass that on instead of dropping it.
            return { success: false, error: result.error || `the SeqImprove server returned HTTP ${response.status}` };
        }

        return result;
    }
    catch (err) {
        console.error("Library import error:", err);
        if (!quiet) showServerErrorNotification();
        return {
            success: false,
            error: err.name === "AbortError"
                ? "the import timed out after 5 minutes (a very large collection can take longer)"
                : "the SeqImprove server could not be reached",
        };
    }
}

export async function checkLibraryCache(url) {
    try {
        const response = await fetch(`${import.meta.env.VITE_API_LOCATION}/api/checkLibraryCache`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url, ...synBioHubCredentials() }),
        });
        const result = await response.json();
        return result.cached;
    } catch (err) {
        console.error("Failed to check library cache:", err);
        return false;
    }
}

export async function deleteLibrary(libraryURL) {
  try {
    var response = await fetchWithTimeout(
      `${import.meta.env.VITE_API_LOCATION}/api/deleteUserLibrary`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: libraryURL,
          ...synBioHubCredentials(),
        }),
        timeout: 120000,
      }
    );
  } catch (err) {
    console.error("Failed to fetch.");
    showServerErrorNotification();
    return;
  }

  try {
    var result = await response.json();
    showNotificationSuccess("Success!", result.response);
    console.log(result);
  } catch (err) {
    console.error("Error deleting library from memory: " + err);
    showServerErrorNotification();
    return;
  }
}

export async function cleanSBOL(sbolContent) {
  try {
    var response = await fetchWithTimeout(
      `${import.meta.env.VITE_API_LOCATION}/api/cleanSBOL`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          completeSbolContent: sbolContent,
        }),
        timeout: 120000,
      }
    );
  } catch (err) {
    console.error("Failed to fetch.");
    showServerErrorNotification();
    return;
  }

  try {
    var result = await response.json();
  } catch (err) {
    console.error("Couldn't parse JSON.");
    showServerErrorNotification();
    return;
  }

  if (response.status == 200) {
    console.log("Clean SBOL fetched.");
    return result.sbol;
  }
}

export async function fetchAnnotateSequence({
  sbolContent,
  selectedLibraryFileNames,
  isUriCleaned,
  algorithm,
  allowSimilarDNAMatches,
  allowSimilarMatches,
  codonMatches,
  includeHypothetical,
  isCircular,
  dnaIdentityThreshold,
  applyNms,
  minFeatureLength,
}) {
  console.log("Annotating sequence...");

  // Fetch
  try {
    var response = await fetchWithTimeout(
      `${import.meta.env.VITE_API_LOCATION}/api/annotateSequence`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          completeSbolContent: sbolContent,
          partLibraries: selectedLibraryFileNames,
          cleanDocument: !isUriCleaned,
          algorithm: algorithm,
          allowSimilarDNAMatches: allowSimilarDNAMatches,
          allowSimilarMatches: allowSimilarMatches,
          codonMatches: codonMatches,
          includeHypothetical: includeHypothetical,
          isCircular: isCircular,
          dnaIdentityThreshold: dnaIdentityThreshold,
          applyNms: applyNms,
          minFeatureLength: minFeatureLength,
          // Lets the server resolve the caller and reach their private
          // libraries; omitted for an anonymous user, who gets public only.
          ...synBioHubCredentials(),
        }),
        timeout: 320000,
      }
    );
  } catch (err) {
    console.error("Failed to fetch.");
    showServerErrorNotification();
    return;
  }

  // Parse
  try {
    var result = await response.json();
  } catch (err) {
    console.error("Couldn't parse JSON.");
    showServerErrorNotification();
    return;
  }

    if (!response.ok || result.error_message) {
        const msg = result.error_message || `Server returned HTTP ${response.status}`;
        console.error("Annotation failed:", msg);
        throw new Error(msg);
    }

    const annoLibsAssoc = result.annotations;

    if (!annoLibsAssoc || annoLibsAssoc.length === 0) {
        console.warn("No annotations returned from server:", result);
        return { fetchedAnnotations: [], synbictDoc: null };
    }

    let annotations = [];
    let synbictDoc = null;

  // process each library annotation result separately to avoid matchOne errors
  // when the same component definition exists in multiple libraries
  await Promise.all(
    annoLibsAssoc.map(([sbolAnnotated, partLibrary]) => {
      return (async () => {
        // create and load annotated doc for each library separately
        const annDoc = new SBOL2GraphView(new Graph());
        await annDoc.loadString(sbolAnnotated);

        // Store the first document as the synbictDoc (they should all have the same root component)
        if (!synbictDoc) {
          synbictDoc = annDoc;
        }

        // concatenate new annotations to result
        annotations = annotations.concat(
          annDoc.rootComponentDefinitions[0].sequenceAnnotations
            // This run's output is exactly the Component-backed annotations in
            // the returned document: the server ran clean_target_document, which
            // deleted the previous run's before annotating.
            //
            // Do NOT filter against the document we sent. After the first run it
            // contains the previous run's annotations, and SYNBICT reuses their
            // persistent identities, so every result would be discarded --
            // observed as 8 annotations, then 0, then 3 over three runs.
            //
            // Bare (Component-less) annotations came with the uploaded file,
            // survive cleaning, and are already in the store from load time, so
            // they must not be re-added here. Excluding them also keeps
            // `sa.component.definition` below from dereferencing undefined.
            .filter((sa) => sa.component)
            // just return the info we need
            .map((sa) => ({
              name: sa.displayName,
              id: sa.persistentIdentity,
              // Envelope (min start..max end across all ranges) — used by callers
              // that just need a single position for navigation/selection.
              location: [sa.rangeMin - 1, sa.rangeMax],
              // All Range objects — needed by the highlighter so wrap-around
              // features on circular plasmids render as two separate blocks
              // instead of one big block covering the whole envelope.
              // SBOL Range.start is 1-based, but SYNBICT2 writes start=0 for
              // the wrap-around continuation Range — clamp to 0 so the
              // 0-based array index doesn't go negative.
              locations: sa.rangeLocations.map((r) => [Math.max(0, r.start - 1), r.end]),
              componentInstance: sa.component,
              featureLibrary: sa.component.definition.persistentIdentity,
              enabled: true,
              // Everything an annotation run produces references a Component.
              // Bare (component-less) annotations only ever come from the
              // uploaded file -- see getExistingSequenceAnnotations.
              isPart: true,
            }))
        );
      })();
    })
  );

  return { fetchedAnnotations: annotations, synbictDoc: synbictDoc };
}

export async function fetchAnnotateText(text) {
  console.log("Annotating text...");

  // Fetch
  try {
    var response = await fetchWithTimeout(
      `${import.meta.env.VITE_API_LOCATION}/api/annotateText`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
        timeout: 120000,
      }
    );
  } catch (err) {
    console.error("Failed to fetch.");
    showServerErrorNotification();
    throw err;
  }

  // Parse
  try {
    var result = await response.json();
  } catch (err) {
    console.error("Couldn't parse JSON.");
    showServerErrorNotification();
    return;
  }

  console.log("Successfully annotated.");
  // https://bioregistry.io/NCBITaxon:562
  result.annotations.forEach((anno, i) => {
    result.annotations[i].id = "https://bioregistry.io/" + anno.displayId;
  });
  return result.annotations;
}

export async function fetchSimilarParts(topLevelUri) {
  console.log("Fetching similar parts...");

  // Fetch
  try {
    var response = await fetch(
      `${import.meta.env.VITE_API_LOCATION}/api/findSimilarParts`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ topLevelUri }),
      }
    );
  } catch (err) {
    console.error("Failed to fetch.");
    showServerErrorNotification();
    return;
  }

  // Parse
  try {
    var result = await response.json();
  } catch (err) {
    console.error("Couldn't parse JSON.");
    showServerErrorNotification();
    return;
  }

  console.log("Successfully fetched similar parts.");
  return result.similarParts;
}

export async function updateDocumentProperties(sbolContent, title, displayId) {
  try {
    var response = await fetchWithTimeout(
      `${import.meta.env.VITE_API_LOCATION}/api/updateDocumentProperties`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sbolContent: sbolContent,
          title: title,
          displayId: displayId,
        }),
        timeout: 30000,
      }
    );
  } catch (err) {
    console.error("Failed to fetch.");
    showServerErrorNotification();
    return { sbolContent: "", error: "Network error" };
  }

  try {
    var result = await response.json();
  } catch (err) {
    console.error("Couldn't parse JSON.");
    showServerErrorNotification();
    return { sbolContent: "", error: "Parse error" };
  }

  if (response.status == 200) {
    console.log("Document properties updated successfully.");
    return result;
  } else {
    return { sbolContent: "", error: result.error || "Server error" };
  }
}

async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 8000 } = options;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  const response = await fetch(resource, {
    ...options,
    signal: controller.signal,
  });
  clearTimeout(id);

  return response;
}
