use ielts_db::import::evaluation_v3_to_v4;
use ielts_domain::domain::EvaluationStatus;
use proptest::prelude::*;
use serde_json::json;

proptest! {
    #[test]
    fn random_valid_score_maps_to_v4(
        overall in 0.0f64..9.0,
        tr in 0.0f64..9.0,
        cc in 0.0f64..9.0,
        lr in 0.0f64..9.0,
        gra in 0.0f64..9.0,
    ) {
        let raw = json!({
            "schemaVersion": "v3",
            "status": "completed",
            "task_type": "task2",
            "total_score": overall,
            "task_achievement": tr,
            "coherence_cohesion": cc,
            "lexical_resource": lr,
            "grammatical_range": gra,
            "feedback": "ok",
            "improvement_plan": ["a"],
            "review_degraded": false
        });
        let v4 = evaluation_v3_to_v4(&raw).expect("convert");
        assert_eq!(v4.status, EvaluationStatus::Completed);
        let score = v4.score.expect("score");
        assert!((score.overall - overall).abs() < 1e-9);
        assert!((score.task_response - tr).abs() < 1e-9);
        assert!((score.coherence - cc).abs() < 1e-9);
        assert!((score.lexical - lr).abs() < 1e-9);
        assert!((score.grammar - gra).abs() < 1e-9);
    }
}

proptest! {
    #[test]
    fn scorecard_aliases_match_top_level(
        overall in 0.0f64..9.0,
        tr in 0.0f64..9.0,
        cc in 0.0f64..9.0,
        lr in 0.0f64..9.0,
        gra in 0.0f64..9.0,
    ) {
        let raw = json!({
            "status": "completed",
            "scorecard": {
                "overall": overall,
                "TR": tr,
                "CC": cc,
                "LR": lr,
                "GRA": gra
            },
            "overall_feedback": "body",
            "improvement_plan": []
        });
        let v4 = evaluation_v3_to_v4(&raw).expect("convert");
        let score = v4.score.expect("score");
        assert!((score.overall - overall).abs() < 1e-9);
        assert!((score.task_response - tr).abs() < 1e-9);
    }
}
